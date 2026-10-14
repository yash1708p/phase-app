import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { encryptForSubscription } from '../lib/webpush';
import { createApp } from '../../server/app';
import { sqliteAdapter } from '../../server/db';
import { SCHEMA } from '../../server/schema';
import { getVapid, processQueue, sendPush, validEndpoint } from '../../server/push';

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64url');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

/** A pretend phone: its push keys, and RFC 8291 decryption like a browser does. */
async function fakeDevice() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const p256dh = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  type B = Uint8Array<ArrayBuffer>;
  const hkdf = async (salt: B, ikm: B, info: B, n: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const decrypt = async (body: Uint8Array<ArrayBuffer>) => {
    const salt = body.slice(0, 16);
    const idlen = body[20];
    const asPublic = body.slice(21, 21 + idlen);
    const ct = body.slice(21 + idlen);
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, pair.privateKey, 256));
    const te = new TextEncoder();
    const ikm = await hkdf(auth, ecdh, new Uint8Array([...te.encode('WebPush: info\0'), ...p256dh, ...asPublic]), 32);
    const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
    const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
    expect(pt[pt.length - 1]).toBe(2); // last-record delimiter
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096);
    return new TextDecoder().decode(pt.slice(0, -1));
  };
  return { p256dh: b64(p256dh), auth: b64(auth), decrypt };
}

describe('push encryption (RFC 8291)', () => {
  it('only the receiving device can read the notification', async () => {
    const phone = await fakeDevice();
    const other = await fakeDevice();
    const msg = JSON.stringify({ title: 'Sorry today’s rough 💛', body: 'A heat pad can help.' });
    const body = await encryptForSubscription(msg, phone.p256dh, phone.auth);
    expect(await phone.decrypt(body)).toBe(msg);
    await expect(other.decrypt(body)).rejects.toThrow();
    expect(new TextDecoder().decode(body)).not.toContain('heat pad');
  });
});

describe('push server', () => {
  const endpoint = 'https://web.push.apple.com/QGuQyavXutnMH8qVKUnrl8wdhGGGeh';

  async function setup() {
    const db = sqliteAdapter(new DatabaseSync(':memory:'), SCHEMA);
    const app = createApp({ db });
    const req = (path: string, init: { method?: string; body?: unknown; token?: string } = {}) =>
      app.request(`/api${path}`, {
        method: init.method ?? (init.body ? 'POST' : 'GET'),
        headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
    const reg = await (await req('/register', { body: { username: 'maya', salt: 'c2FsdHNhbHRzYWx0c2FsdA', iterations: 310000, authKey: 'a'.repeat(43), vault: { iv: 'aXZpdml2aXZpdml2', ciphertext: 'Y2lwaGVy' } } })).json();
    return { db, req, token: reg.token as string };
  }

  it('creates its own push keys and secret on first run (nothing to configure)', async () => {
    const { db, req } = await setup();
    const { publicKey } = await (await req('/push/key')).json();
    expect(unb64(publicKey)).toHaveLength(65);
    expect((await getVapid(db)).publicKey).toBe(publicKey); // stable
    const pre = await (await req('/prelogin', { body: { username: 'nobody' } })).json();
    expect(pre.salt).toHaveLength(22);
  });

  it('only accepts real push-service addresses', () => {
    expect(validEndpoint(endpoint)).toBe(true);
    expect(validEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(validEndpoint('https://evil.example.com/x')).toBe(false);
    expect(validEndpoint('http://fcm.googleapis.com/x')).toBe(false);
  });

  it('stores encrypted notifications and sends them when due', async () => {
    const { db, req, token } = await setup();
    expect((await req('/push/schedule', { method: 'PUT', token, body: { endpoint, items: [] } })).status).toBe(404); // not subscribed yet
    expect((await req('/push/subscribe', { token, body: { endpoint } })).status).toBe(200);
    const now = Date.now();
    const items = [
      { at: now + 60_000, payload: 'ZW5jcnlwdGVkLTE' },
      { at: now + 3_600_000, payload: 'ZW5jcnlwdGVkLTI' },
    ];
    expect((await req('/push/schedule', { method: 'PUT', token, body: { endpoint, items } })).status).toBe(200);

    const sent: { endpoint: string; payload: string }[] = [];
    const fakeSend = async (_v: unknown, e: string, p: string) => {
      sent.push({ endpoint: e, payload: p });
      return 201;
    };
    await processQueue(db, { now, subject: 'mailto:x@y.z', send: fakeSend as never });
    expect(sent).toHaveLength(0); // nothing due yet
    await processQueue(db, { now: now + 61_000, subject: 'mailto:x@y.z', send: fakeSend as never });
    expect(sent).toEqual([{ endpoint, payload: 'ZW5jcnlwdGVkLTE' }]);
    await processQueue(db, { now: now + 61_000, subject: 'mailto:x@y.z', send: fakeSend as never });
    expect(sent).toHaveLength(1); // never sent twice
  });

  it('forgets devices that unsubscribed (404/410)', async () => {
    const { db, req, token } = await setup();
    await req('/push/subscribe', { token, body: { endpoint } });
    await req('/push/schedule', { method: 'PUT', token, body: { endpoint, items: [{ at: Date.now(), payload: 'eA' }] } });
    await processQueue(db, { subject: 'mailto:x@y.z', send: (async () => 410) as never });
    expect(await db.get('SELECT * FROM push_subscriptions')).toBeUndefined();
  });

  it('signs push requests with a valid VAPID token', async () => {
    const { db } = await setup();
    const vapid = await getVapid(db);
    const realFetch = globalThis.fetch;
    let headers: Headers | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      headers = new Headers(init.headers);
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    try {
      expect(await sendPush(vapid, endpoint, 'eA', 'mailto:x@y.z')).toBe(201);
    } finally {
      globalThis.fetch = realFetch;
    }
    const auth = headers!.get('authorization')!;
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(auth)!;
    expect(k).toBe(vapid.publicKey);
    const [h, p, sig] = jwt.split('.');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(claims.aud).toBe('https://web.push.apple.com');
    const pub = await crypto.subtle.importKey('raw', unb64(vapid.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64(sig), new TextEncoder().encode(`${h}.${p}`))).toBe(true);
    expect(headers!.get('content-encoding')).toBe('aes128gcm');
  });
});
