/**
 * Web Push on the device side.
 *
 * Lets the home-screen web app (iPhone 16.4+, Android, desktop) receive
 * notifications while Phase is closed:
 *   1. subscribe this device with the browser's push service;
 *   2. encrypt each planned notification *for this device only* (RFC 8291,
 *      aes128gcm) — the Phase server never sees the text;
 *   3. upload the encrypted notifications with their send times; the server
 *      delivers them at the right moment (it checks every minute).
 */
import { call } from './cloud';
import type { PlannedNotification } from './notifications';

const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;

const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (b64: string): Bytes => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/**
 * Encrypt a push message for a subscription (RFC 8291 + RFC 8188, aes128gcm).
 * Only the device holding the subscription's private key can read it.
 */
export async function encryptForSubscription(plaintext: string, p256dhB64: string, authB64: string): Promise<Bytes> {
  const uaPublic = fromB64(p256dhB64);
  const authSecret = fromB64(authB64);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, concat(enc.encode('Content-Encoding: aes128gcm\0')), 16);
  const nonce = await hkdf(salt, ikm, concat(enc.encode('Content-Encoding: nonce\0')), 12);

  const record = concat(enc.encode(plaintext), new Uint8Array([2])); // 0x02 = last record, no padding
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/* ------------------------------------------------------------------ */
/* Subscription                                                         */
/* ------------------------------------------------------------------ */

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration() {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

let cachedKey: string | null = null;

/**
 * Subscribe this device (if needed) and register it with the Phase server.
 * Returns the subscription, or null if push isn't available here.
 */
export async function ensurePushSubscription(token: string): Promise<PushSubscription | null> {
  const reg = await registration();
  if (!reg || Notification.permission !== 'granted') return null;
  cachedKey ??= (await call<{ publicKey: string }>('/push/key')).data.publicKey;
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a different server key can't be used; replace it.
  const currentKey = sub?.options.applicationServerKey ? toB64(sub.options.applicationServerKey) : null;
  if (sub && currentKey && currentKey !== cachedKey) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64(cachedKey) });
  await call('/push/subscribe', { body: { endpoint: sub.endpoint }, token });
  return sub;
}

export async function removePushSubscription(token: string | undefined) {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  if (token) await call('/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint }, token }).catch(() => undefined);
}

async function encryptNotification(sub: PushSubscription, n: { key: string; title: string; body: string }) {
  const p256dh = sub.getKey('p256dh');
  const auth = sub.getKey('auth');
  if (!p256dh || !auth) throw new Error('Push keys missing');
  const json = JSON.stringify({ key: n.key, title: n.title, body: n.body });
  return toB64(await encryptForSubscription(json, toB64(p256dh), toB64(auth)));
}

let lastSignature = '';

/** Upload this device's upcoming notifications (replaces what was there). Skips if nothing changed. */
export async function uploadSchedule(token: string, sub: PushSubscription, plan: PlannedNotification[]) {
  const now = Date.now();
  const items = plan.filter((n) => n.at > now - 60_000).slice(0, 40);
  const signature = `${sub.endpoint}|${items.map((n) => `${n.key}@${n.at}:${n.title}|${n.body}`).join('\n')}`;
  if (signature === lastSignature) return;
  const encrypted = await Promise.all(items.map(async (n) => ({ at: Math.max(n.at, now), payload: await encryptNotification(sub, n) })));
  await call('/push/schedule', { method: 'PUT', body: { endpoint: sub.endpoint, items: encrypted }, token });
  lastSignature = signature;
}

/** Send a notification through the whole push pipeline right now. */
export async function sendTestPush(token: string, sub: PushSubscription, title: string, body: string) {
  const payload = await encryptNotification(sub, { key: 'test', title, body });
  const { data } = await call<{ ok: boolean }>('/push/test', { body: { endpoint: sub.endpoint, payload }, token });
  return data.ok;
}

export const resetPushCache = () => {
  lastSignature = '';
};
