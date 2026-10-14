/**
 * Web Push sending (works for iPhone home-screen web apps, Android and desktop).
 *
 * Privacy: the phone encrypts each notification for itself (RFC 8291) before
 * uploading it, so this server only stores an opaque blob and the time to send
 * it. It signs requests with a VAPID key (RFC 8292) that it generates and keeps
 * in its own database on first run — nothing to configure.
 */
import type { DB } from './db';

const enc = new TextEncoder();

export const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const fromB64 = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** Only real browser push services, so the server can't be used to call arbitrary URLs. */
const PUSH_HOSTS = ['push.apple.com', 'fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com'];

export function validEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Server config (generated once, stored in the database)               */
/* ------------------------------------------------------------------ */

export async function getConfig(db: DB, key: string, create: () => Promise<string>): Promise<string> {
  const row = await db.get<{ value: string }>('SELECT value FROM config WHERE key = ?', key);
  if (row) return row.value;
  await db.run('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)', key, await create());
  return (await db.get<{ value: string }>('SELECT value FROM config WHERE key = ?', key))!.value;
}

export interface Vapid {
  publicKey: string; // base64url, uncompressed P-256 point (what browsers call applicationServerKey)
  privateJwk: JsonWebKey;
}

export async function getVapid(db: DB): Promise<Vapid> {
  const json = await getConfig(db, 'vapid', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicKey = toB64(await crypto.subtle.exportKey('raw', pair.publicKey));
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    return JSON.stringify({ publicKey, privateJwk });
  });
  return JSON.parse(json) as Vapid;
}

async function vapidHeader(vapid: Vapid, endpoint: string, subject: string) {
  const header = toB64(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = toB64(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${toB64(sig)}, k=${vapid.publicKey}`;
}

/** Deliver one already-encrypted payload. Returns the push service's HTTP status. */
export async function sendPush(vapid: Vapid, endpoint: string, payloadB64: string, subject: string, ttlSeconds = 6 * 3600): Promise<number> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(vapid, endpoint, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttlSeconds),
      Urgency: 'normal',
    },
    body: fromB64(payloadB64),
  });
  return res.status;
}

/* ------------------------------------------------------------------ */
/* The queue — run every minute                                         */
/* ------------------------------------------------------------------ */

const BATCH = 40; // stays well under the free plan's per-run request limit

export async function processQueue(db: DB, opts: { now?: number; subject: string; send?: typeof sendPush }) {
  const now = opts.now ?? Date.now();
  const send = opts.send ?? sendPush;
  // Anything more than 6 hours late is no longer useful.
  await db.run('DELETE FROM push_queue WHERE send_at < ?', now - 6 * 3600_000);
  const due = await db.all<{ id: number; payload: string; endpoint: string; subscription_id: number }>(
    `SELECT q.id, q.payload, s.endpoint, q.subscription_id
       FROM push_queue q JOIN push_subscriptions s ON s.id = q.subscription_id
      WHERE q.send_at <= ? ORDER BY q.send_at LIMIT ?`,
    now,
    BATCH,
  );
  if (!due.length) return { sent: 0, failed: 0 };
  const vapid = await getVapid(db);
  let sent = 0;
  let failed = 0;
  for (const item of due) {
    let status = 0;
    try {
      status = await send(vapid, item.endpoint, item.payload, opts.subject);
    } catch {
      status = 0;
    }
    if (status >= 200 && status < 300) {
      sent++;
      await db.run('DELETE FROM push_queue WHERE id = ?', item.id);
    } else if (status === 404 || status === 410) {
      // The phone unsubscribed or uninstalled — forget this device.
      failed++;
      await db.run('DELETE FROM push_queue WHERE subscription_id = ?', item.subscription_id);
      await db.run('DELETE FROM push_subscriptions WHERE id = ?', item.subscription_id);
    } else if (status >= 400 && status < 500 && status !== 429) {
      failed++;
      await db.run('DELETE FROM push_queue WHERE id = ?', item.id); // won't succeed on retry
    } else {
      failed++; // network / 429 / 5xx: try again next minute
    }
  }
  return { sent, failed };
}
