/**
 * Phase sync server.
 *
 * End-to-end encrypted: the phone turns the password into two keys —
 * an *encryption key* that never leaves the device, and an *auth key* that is
 * sent here to prove who you are. The server stores only a hash of the auth
 * key and the user's data as an AES-GCM blob it cannot decrypt.
 *
 * Signing up is limited: an optional invite code (SIGNUP_CODE) and a maximum
 * number of accounts (MAX_USERS).
 */
import { Hono, type Context } from 'hono';

import type { DB } from './db';
import { getConfig, getVapid, LAST_RUN_KEY, pushOk, recordResult, sendPush, validEndpoint } from './push';

export interface ServerConfig {
  db: DB;
  /** Random secret used to return believable salts for unknown usernames. Generated and stored automatically if not set. */
  secret?: string;
  /** Contact for push services (VAPID "sub"). */
  pushSubject?: string;
  /** If set, people need this code to create an account. */
  signupCode?: string;
  /** Maximum number of accounts (default 25). */
  maxUsers?: number;
  /** For tests. */
  now?: () => number;
}

const DAY = 86_400_000;
const SESSION_DAYS = 60;
const MAX_VAULT_CHARS = 8_000_000; // ~6 MB of encrypted data — years of daily logs
const DEFAULT_ITERATIONS = 310_000;

const B64URL = /^[A-Za-z0-9_-]+$/;
const enc = new TextEncoder();

/* ------------------------------------------------------------------ */
/* Crypto helpers (WebCrypto works in both Node 20+ and Workers)        */
/* ------------------------------------------------------------------ */

const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const sha256 = async (text: string) => toB64(await crypto.subtle.digest('SHA-256', enc.encode(text)));

async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toB64(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const randomToken = () => toB64(crypto.getRandomValues(new Uint8Array(32)));

/* ------------------------------------------------------------------ */
/* Validation                                                           */
/* ------------------------------------------------------------------ */

export const normalizeUsername = (u: unknown) => (typeof u === 'string' ? u.trim().toLowerCase() : '');
const validUsername = (u: string) => /^[a-z0-9._-]{3,32}$/.test(u);
const validKey = (k: unknown): k is string => typeof k === 'string' && k.length >= 40 && k.length <= 100 && B64URL.test(k);
const validSalt = (s: unknown): s is string => typeof s === 'string' && s.length >= 16 && s.length <= 64 && B64URL.test(s);
const validIterations = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 100_000 && (n as number) <= 5_000_000;

interface Vault {
  iv: string;
  ciphertext: string;
}
const validVault = (v: unknown): v is Vault =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as Vault).iv === 'string' &&
  B64URL.test((v as Vault).iv) &&
  (v as Vault).iv.length <= 32 &&
  typeof (v as Vault).ciphertext === 'string' &&
  B64URL.test((v as Vault).ciphertext) &&
  (v as Vault).ciphertext.length <= MAX_VAULT_CHARS;

/* ------------------------------------------------------------------ */
/* App                                                                  */
/* ------------------------------------------------------------------ */

interface UserRow {
  id: number;
  username: string;
  salt: string;
  iterations: number;
  auth_hash: string;
}

type Vars = { Variables: { userId: number; tokenHash: string } };

export function createApp(cfg: ServerConfig) {
  const { db } = cfg;
  const now = cfg.now ?? (() => Date.now());
  const maxUsers = cfg.maxUsers ?? 25;
  const app = new Hono<Vars>().basePath('/api');
  const subject = cfg.pushSubject ?? 'mailto:phase-app@users.noreply.github.com';
  const secret = () => (cfg.secret ? Promise.resolve(cfg.secret) : getConfig(db, 'secret', async () => randomToken()));

  const error = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 413 | 429, message: string, extra: object = {}) =>
    c.json({ error: message, ...extra }, status);

  // Behind the Vercel proxy, the user's address arrives in x-forwarded-for.
  const clientIp = (c: Context) =>
    c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.req.header('cf-connecting-ip') || 'unknown';

  /* ---- rate limiting (stored in the DB so it works across Worker instances) */
  async function limited(key: string, max: number) {
    const row = await db.get<{ count: number; reset_at: number }>('SELECT count, reset_at FROM rate_limits WHERE key = ?', key);
    return !!row && row.reset_at > now() && row.count >= max;
  }
  async function hit(key: string, windowMs: number) {
    const t = now();
    const row = await db.get<{ count: number; reset_at: number }>('SELECT count, reset_at FROM rate_limits WHERE key = ?', key);
    if (!row || row.reset_at <= t) {
      await db.run('INSERT OR REPLACE INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)', key, t + windowMs);
    } else {
      await db.run('UPDATE rate_limits SET count = count + 1 WHERE key = ?', key);
    }
  }
  const clearLimit = (key: string) => db.run('DELETE FROM rate_limits WHERE key = ?', key);

  async function newSession(userId: number) {
    const token = randomToken();
    const t = now();
    await db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', await sha256(token), userId, t, t + SESSION_DAYS * DAY);
    // Housekeeping: drop expired sessions and stale rate limits now and then.
    if (Math.random() < 0.05) {
      await db.run('DELETE FROM sessions WHERE expires_at < ?', t);
      await db.run('DELETE FROM rate_limits WHERE reset_at < ?', t);
    }
    return token;
  }

  const userCount = async () => (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users'))?.n ?? 0;

  async function body<T>(c: Context): Promise<Partial<T>> {
    try {
      return (await c.req.json()) as Partial<T>;
    } catch {
      return {};
    }
  }

  /* ---- auth middleware */
  const requireAuth = async (c: Context<Vars>, next: () => Promise<void>) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return error(c, 401, 'Please sign in again.');
    const tokenHash = await sha256(token);
    const row = await db.get<{ user_id: number; expires_at: number }>('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', tokenHash);
    if (!row || row.expires_at < now()) return error(c, 401, 'Your session has expired. Please sign in again.');
    c.set('userId', row.user_id);
    c.set('tokenHash', tokenHash);
    await next();
  };

  /* ------------------------------------------------------------------ */

  app.use('*', async (c, next) => {
    await db.init(); // creates the tables on first run
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
  });

  app.get('/health', async (c) => {
    const count = await userCount();
    return c.json({ ok: true, signup: { open: count < maxUsers, codeRequired: !!cfg.signupCode } });
  });

  /** Salt + iterations for a username. Unknown usernames get a believable fake, so this can't be used to check who has an account. */
  app.post('/prelogin', async (c) => {
    const { username } = await body<{ username: string }>(c);
    const u = normalizeUsername(username);
    if (!validUsername(u)) return error(c, 400, 'Invalid username.');
    const row = await db.get<UserRow>('SELECT salt, iterations FROM users WHERE username = ?', u);
    if (row) return c.json({ salt: row.salt, iterations: row.iterations });
    return c.json({ salt: (await hmac(await secret(), `salt:${u}`)).slice(0, 22), iterations: DEFAULT_ITERATIONS });
  });

  app.post('/register', async (c) => {
    const b = await body<{ username: string; salt: string; iterations: number; authKey: string; inviteCode: string; vault: Vault }>(c);
    const u = normalizeUsername(b.username);
    const ip = clientIp(c);
    if (await limited(`register-ip:${ip}`, 10)) return error(c, 429, 'Too many sign-up attempts. Please try again tomorrow.');
    await hit(`register-ip:${ip}`, DAY);

    if (cfg.signupCode && !safeEqual(String(b.inviteCode ?? '').trim(), cfg.signupCode)) return error(c, 403, 'That invite code isn’t right.');
    if (!validUsername(u)) return error(c, 400, 'Use 3–32 letters, numbers, dots, dashes or underscores.');
    if (!validSalt(b.salt) || !validIterations(b.iterations) || !validKey(b.authKey) || !validVault(b.vault)) return error(c, 400, 'Invalid request.');
    if ((await userCount()) >= maxUsers) return error(c, 403, 'Phase is full right now — no new accounts can be created.');
    if (await db.get('SELECT id FROM users WHERE username = ?', u)) return error(c, 409, 'That username is already taken.');

    const t = now();
    await db.run('INSERT INTO users (username, salt, iterations, auth_hash, created_at) VALUES (?, ?, ?, ?, ?)', u, b.salt, b.iterations, await sha256(b.authKey), t);
    const user = await db.get<UserRow>('SELECT id FROM users WHERE username = ?', u);
    await db.run('INSERT INTO vaults (user_id, iv, ciphertext, version, updated_at) VALUES (?, ?, ?, 1, ?)', user!.id, b.vault.iv, b.vault.ciphertext, t);
    return c.json({ token: await newSession(user!.id), version: 1 }, 201);
  });

  app.post('/login', async (c) => {
    const b = await body<{ username: string; authKey: string }>(c);
    const u = normalizeUsername(b.username);
    const ip = clientIp(c);
    const userKey = `login-user:${u}`;
    const ipKey = `login-ip:${ip}`;
    if ((await limited(userKey, 10)) || (await limited(ipKey, 100))) {
      return error(c, 429, 'Too many attempts. Please wait 15 minutes and try again.');
    }
    const row = validUsername(u) ? await db.get<UserRow>('SELECT id, auth_hash FROM users WHERE username = ?', u) : undefined;
    const ok = !!row && validKey(b.authKey) && safeEqual(await sha256(b.authKey), row.auth_hash);
    if (!ok) {
      await hit(userKey, 15 * 60_000);
      await hit(ipKey, 15 * 60_000);
      return error(c, 401, 'Username or password is incorrect.');
    }
    await clearLimit(userKey);
    const vault = await db.get<{ iv: string; ciphertext: string; version: number }>('SELECT iv, ciphertext, version FROM vaults WHERE user_id = ?', row!.id);
    return c.json({ token: await newSession(row!.id), vault: vault ? { iv: vault.iv, ciphertext: vault.ciphertext } : null, version: vault?.version ?? 0 });
  });

  app.post('/logout', requireAuth, async (c) => {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', c.get('tokenHash'));
    return c.json({ ok: true });
  });

  /** Latest data. Pass ?since=<version> to get 204 when nothing changed. */
  app.get('/vault', requireAuth, async (c) => {
    const row = await db.get<{ iv: string; ciphertext: string; version: number }>('SELECT iv, ciphertext, version FROM vaults WHERE user_id = ?', c.get('userId'));
    if (!row) return error(c, 404, 'No data yet.');
    const since = Number(c.req.query('since'));
    if (Number.isFinite(since) && since >= row.version) return c.body(null, 204);
    return c.json({ vault: { iv: row.iv, ciphertext: row.ciphertext }, version: row.version });
  });

  /** Save data. `baseVersion` must match the server's version, otherwise 409 with the newer data so the device can merge. */
  app.put('/vault', requireAuth, async (c) => {
    const b = await body<{ vault: Vault; baseVersion: number }>(c);
    if (!validVault(b.vault) || !Number.isInteger(b.baseVersion)) return error(c, 400, 'Invalid request.');
    const userId = c.get('userId');
    const res = await db.run(
      'UPDATE vaults SET iv = ?, ciphertext = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?',
      b.vault.iv,
      b.vault.ciphertext,
      now(),
      userId,
      b.baseVersion,
    );
    const row = await db.get<{ iv: string; ciphertext: string; version: number }>('SELECT iv, ciphertext, version FROM vaults WHERE user_id = ?', userId);
    if (!res.changes) return error(c, 409, 'Your data changed on another device.', { vault: { iv: row!.iv, ciphertext: row!.ciphertext }, version: row!.version });
    return c.json({ version: row!.version });
  });

  /** Change password: proves the old auth key, swaps in the new one and the re-encrypted data, and signs out other devices. */
  app.post('/password', requireAuth, async (c) => {
    const b = await body<{ authKey: string; newSalt: string; newIterations: number; newAuthKey: string; vault: Vault }>(c);
    if (!validKey(b.authKey) || !validKey(b.newAuthKey) || !validSalt(b.newSalt) || !validIterations(b.newIterations) || !validVault(b.vault)) {
      return error(c, 400, 'Invalid request.');
    }
    const userId = c.get('userId');
    const user = await db.get<UserRow>('SELECT auth_hash FROM users WHERE id = ?', userId);
    if (!user || !safeEqual(await sha256(b.authKey), user.auth_hash)) return error(c, 403, 'Current password is incorrect.');
    await db.run('UPDATE users SET salt = ?, iterations = ?, auth_hash = ? WHERE id = ?', b.newSalt, b.newIterations, await sha256(b.newAuthKey), userId);
    await db.run('UPDATE vaults SET iv = ?, ciphertext = ?, version = version + 1, updated_at = ? WHERE user_id = ?', b.vault.iv, b.vault.ciphertext, now(), userId);
    await db.run('DELETE FROM sessions WHERE user_id = ?', userId);
    const version = (await db.get<{ version: number }>('SELECT version FROM vaults WHERE user_id = ?', userId))!.version;
    return c.json({ token: await newSession(userId), version });
  });

  app.delete('/account', requireAuth, async (c) => {
    const b = await body<{ authKey: string }>(c);
    const userId = c.get('userId');
    const user = await db.get<UserRow>('SELECT auth_hash FROM users WHERE id = ?', userId);
    if (!user || !validKey(b.authKey) || !safeEqual(await sha256(b.authKey), user.auth_hash)) return error(c, 403, 'Password is incorrect.');
    await db.run('DELETE FROM push_queue WHERE subscription_id IN (SELECT id FROM push_subscriptions WHERE user_id = ?)', userId);
    await db.run('DELETE FROM push_results WHERE subscription_id IN (SELECT id FROM push_subscriptions WHERE user_id = ?)', userId);
    await db.run('DELETE FROM push_subscriptions WHERE user_id = ?', userId);
    await db.run('DELETE FROM sessions WHERE user_id = ?', userId);
    await db.run('DELETE FROM vaults WHERE user_id = ?', userId);
    await db.run('DELETE FROM users WHERE id = ?', userId);
    return c.json({ ok: true });
  });

  /* ---------------------------------------------------------------- */
  /* Push notifications                                                 */
  /* ---------------------------------------------------------------- */

  /** The public key browsers need to subscribe. */
  app.get('/push/key', async (c) => c.json({ publicKey: (await getVapid(db)).publicKey }));

  async function ownSubscription(userId: number, endpoint: unknown) {
    if (!validEndpoint(endpoint)) return null;
    return db.get<{ id: number }>('SELECT id FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', endpoint, userId);
  }

  /** Register this device for notifications (moves it over if another account used it before). */
  app.post('/push/subscribe', requireAuth, async (c) => {
    const { endpoint } = await body<{ endpoint: string }>(c);
    if (!validEndpoint(endpoint)) return error(c, 400, 'Invalid push address.');
    const userId = c.get('userId');
    const existing = await db.get<{ id: number; user_id: number }>('SELECT id, user_id FROM push_subscriptions WHERE endpoint = ?', endpoint);
    if (existing && existing.user_id !== userId) {
      await db.run('DELETE FROM push_queue WHERE subscription_id = ?', existing.id);
      await db.run('DELETE FROM push_results WHERE subscription_id = ?', existing.id);
      await db.run('UPDATE push_subscriptions SET user_id = ? WHERE id = ?', userId, existing.id);
    } else if (!existing) {
      const count = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', userId))?.n ?? 0;
      if (count >= 10) await db.run('DELETE FROM push_subscriptions WHERE id = (SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at LIMIT 1)', userId);
      await db.run('INSERT INTO push_subscriptions (user_id, endpoint, created_at) VALUES (?, ?, ?)', userId, endpoint, now());
    }
    return c.json({ ok: true });
  });

  app.delete('/push/subscribe', requireAuth, async (c) => {
    const { endpoint } = await body<{ endpoint: string }>(c);
    const sub = await ownSubscription(c.get('userId'), endpoint);
    if (sub) {
      await db.run('DELETE FROM push_queue WHERE subscription_id = ?', sub.id);
      await db.run('DELETE FROM push_results WHERE subscription_id = ?', sub.id);
      await db.run('DELETE FROM push_subscriptions WHERE id = ?', sub.id);
    }
    return c.json({ ok: true });
  });

  /** Replace this device's upcoming notifications. Each payload is already encrypted on the phone. */
  app.put('/push/schedule', requireAuth, async (c) => {
    const b = await body<{ endpoint: string; items: { at: number; payload: string }[] }>(c);
    const sub = await ownSubscription(c.get('userId'), b.endpoint);
    if (!sub) return error(c, 404, 'This device isn’t registered for notifications.');
    const items = Array.isArray(b.items) ? b.items : [];
    const t = now();
    const ok = items.length <= 40 && items.every((i) => Number.isFinite(i?.at) && i.at > t - 5 * 60_000 && i.at < t + 8 * 86_400_000 && typeof i.payload === 'string' && i.payload.length <= 5000 && B64URL.test(i.payload));
    if (!ok) return error(c, 400, 'Invalid schedule.');
    // Keep anything already due: the every-minute run sends it shortly, and the phone no longer lists it.
    await db.run('DELETE FROM push_queue WHERE subscription_id = ? AND send_at > ?', sub.id, t);
    for (const i of items) await db.run('INSERT INTO push_queue (subscription_id, send_at, payload) VALUES (?, ?, ?)', sub.id, Math.round(i.at), i.payload);
    return c.json({ ok: true, scheduled: items.length });
  });

  /** Send one encrypted notification right away (the "Send a test notification" button). */
  app.post('/push/test', requireAuth, async (c) => {
    const b = await body<{ endpoint: string; payload: string }>(c);
    const sub = await ownSubscription(c.get('userId'), b.endpoint);
    if (!sub || typeof b.payload !== 'string' || b.payload.length > 5000 || !B64URL.test(b.payload)) return error(c, 400, 'Invalid request.');
    if (await limited(`push-test:${c.get('userId')}`, 20)) return error(c, 429, 'Too many test notifications. Try again later.');
    await hit(`push-test:${c.get('userId')}`, 3600_000);
    const result = await sendPush(await getVapid(db), b.endpoint as string, b.payload, subject, 600);
    if (result.status === 404 || result.status === 410) {
      await db.run('DELETE FROM push_queue WHERE subscription_id = ?', sub.id);
      await db.run('DELETE FROM push_results WHERE subscription_id = ?', sub.id);
      await db.run('DELETE FROM push_subscriptions WHERE id = ?', sub.id);
      return c.json({ ok: false, expired: true, status: result.status, reason: result.reason });
    }
    await recordResult(db, sub.id, result);
    return c.json({ ok: pushOk(result), status: result.status, reason: result.reason });
  });

  /** What the server knows about this device's notifications (for the app's notification check). */
  app.post('/push/status', requireAuth, async (c) => {
    const b = await body<{ endpoint: string }>(c);
    const sub = await ownSubscription(c.get('userId'), b.endpoint);
    const lastRunRow = await db.get<{ value: string }>('SELECT value FROM config WHERE key = ?', LAST_RUN_KEY);
    const lastRun = lastRunRow ? Number(lastRunRow.value) : null;
    if (!sub) return c.json({ registered: false, queued: 0, next: null, last: null, lastRun, now: now() });
    const q = await db.get<{ n: number; next: number | null }>('SELECT COUNT(*) AS n, MIN(send_at) AS next FROM push_queue WHERE subscription_id = ?', sub.id);
    const last = await db.get<{ at: number; status: number; reason: string | null }>('SELECT at, status, reason FROM push_results WHERE subscription_id = ?', sub.id);
    return c.json({ registered: true, queued: q?.n ?? 0, next: q?.next ?? null, last: last ?? null, lastRun, now: now() });
  });

  app.notFound((c) => c.json({ error: 'Not found.' }, 404));
  app.onError((err, c) => {
    console.error('[phase-server]', err);
    return c.json({ error: 'Something went wrong on the server.' }, 500);
  });

  return app;
}
