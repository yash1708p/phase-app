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

export interface PushResult {
  /** HTTP status from the push service (0 = it couldn't be reached). */
  status: number;
  /** The push service's explanation when it refused, e.g. "BadJwtToken". */
  reason?: string;
}

export const pushOk = (r: PushResult) => r.status >= 200 && r.status < 300;

/** Deliver one already-encrypted payload. */
export async function sendPush(vapid: Vapid, endpoint: string, payloadB64: string, subject: string, ttlSeconds = 6 * 3600): Promise<PushResult> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(vapid, endpoint, subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttlSeconds),
        Urgency: 'high', // phones may hold back "normal" pushes while asleep
      },
      body: fromB64(payloadB64),
    });
    if (res.status >= 200 && res.status < 300) return { status: res.status };
    let reason = '';
    try {
      const text = (await res.text()).trim();
      try {
        const j = JSON.parse(text) as { reason?: string; message?: string; error?: { message?: string } };
        reason = j.reason ?? j.error?.message ?? j.message ?? text;
      } catch {
        reason = text;
      }
    } catch {
      /* no body */
    }
    return { status: res.status, reason: reason.slice(0, 200) || res.statusText || undefined };
  } catch (e) {
    return { status: 0, reason: e instanceof Error ? e.message.slice(0, 200) : 'Network error' };
  }
}

export async function recordResult(db: DB, subscriptionId: number, r: PushResult, at = Date.now()) {
  await db.run(
    `INSERT INTO push_results (subscription_id, at, status, reason) VALUES (?, ?, ?, ?)
     ON CONFLICT(subscription_id) DO UPDATE SET at = excluded.at, status = excluded.status, reason = excluded.reason`,
    subscriptionId,
    at,
    r.status,
    r.reason ?? null,
  );
}

/* ------------------------------------------------------------------ */
/* The queue — run every minute                                         */
/* ------------------------------------------------------------------ */

const BATCH = 40; // stays well under the free plan's per-run request limit

/** Time of the last queue run, so the app can tell whether the every-minute timer is working. */
export const LAST_RUN_KEY = 'queue_last_run';

export async function processQueue(db: DB, opts: { now?: number; subject: string; send?: typeof sendPush }) {
  const now = opts.now ?? Date.now();
  const send = opts.send ?? sendPush;
  await db.run(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    LAST_RUN_KEY,
    String(now),
  );
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
    const result = await send(vapid, item.endpoint, item.payload, opts.subject);
    const { status } = result;
    if (pushOk(result)) {
      sent++;
      await db.run('DELETE FROM push_queue WHERE id = ?', item.id);
      await recordResult(db, item.subscription_id, result, now);
    } else if (status === 404 || status === 410) {
      // The phone unsubscribed or uninstalled — forget this device.
      failed++;
      await db.run('DELETE FROM push_queue WHERE subscription_id = ?', item.subscription_id);
      await db.run('DELETE FROM push_results WHERE subscription_id = ?', item.subscription_id);
      await db.run('DELETE FROM push_subscriptions WHERE id = ?', item.subscription_id);
    } else if (status >= 400 && status < 500 && status !== 429) {
      failed++;
      await db.run('DELETE FROM push_queue WHERE id = ?', item.id); // won't succeed on retry
      await recordResult(db, item.subscription_id, result, now);
    } else {
      failed++; // network / 429 / 5xx: try again next minute
      await recordResult(db, item.subscription_id, result, now);
    }
  }
  return { sent, failed };
}
