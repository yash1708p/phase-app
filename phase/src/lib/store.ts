/**
 * App store: one source of truth for the signed-in account.
 *
 * Two kinds of account:
 *  - **Synced** (when a Phase server is available): sign in from any device.
 *    The password is turned into an encryption key (never leaves the device)
 *    and an auth key (proves the password to the server). Data is encrypted
 *    on the device, cached locally for offline use, and synced in the background.
 *  - **This device only** (no server, e.g. a static-only deployment): data is
 *    encrypted and stored in this browser only.
 *
 * Components subscribe with `usePhaseData()`; predictions are derived on read
 * (see hooks/useCycle.ts), so they are always up to date.
 */
import { useSyncExternalStore } from 'react';
import type { AccountRecord, AppData, DailyLog, Demographics, EncryptedVault, ISODate, NotificationSettings, ParsedLog, Settings } from '../types';
import { DEFAULT_NOTIFICATION_SETTINGS } from './notifications';
import { addDays, diffDays } from './dates';
import {
  clearLegacyData,
  clearSession,
  deleteVault,
  emptyData,
  loadAccounts,
  loadLegacyData,
  loadSession,
  loadVault,
  migrate,
  saveAccounts,
  saveLastUsername,
  saveSession,
  saveVault,
} from './storage';
import { ACCOUNT_ITERATIONS, VAULT_ITERATIONS, decryptJSON, deriveAccountKeys, deriveVaultKey, encryptJSON, random, toB64 } from './security';
import * as cloud from './cloud';
import { CloudError, OfflineError } from './cloud';
import { adoptRemote, mergeData } from './merge';
import { removePushSubscription, resetPushCache } from './webpush';

type Status = 'booting' | 'signed-out' | 'signed-in';

export type SyncStatus =
  | { state: 'local' } // account lives on this device only
  | { state: 'synced'; at: number }
  | { state: 'syncing' }
  | { state: 'pending' } // changes waiting to upload
  | { state: 'offline' }
  | { state: 'signin'; message: string } // needs the password again
  | { state: 'error'; message: string };

interface Session {
  username: string;
  key: CryptoKey;
  /** Synced accounts only. */
  cloud?: { token?: string; authKey?: string };
}

let state: AppData = emptyData();
let status: Status = 'booting';
let syncStatus: SyncStatus = { state: 'local' };
let session: Session | null = null;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pullTimer: ReturnType<typeof setInterval> | undefined;
let syncing: Promise<void> | null = null;

function emit() {
  listeners.forEach((l) => l());
}

function setSync(s: SyncStatus) {
  syncStatus = s;
  emit();
}

async function record(username: string): Promise<AccountRecord | undefined> {
  return (await loadAccounts())[username];
}

async function updateRecord(username: string, patch: (r: AccountRecord) => AccountRecord) {
  const accounts = await loadAccounts();
  if (!accounts[username]) return;
  accounts[username] = patch(accounts[username]);
  await saveAccounts(accounts);
}

/** Encrypt and save the local copy; mark synced accounts as having changes to upload. */
async function persist(markDirty = true) {
  if (!session) return;
  pendingDirty = false;
  const { username, key } = session;
  await saveVault(username, await encryptJSON(key, state));
  if (session.cloud && markDirty) {
    await updateRecord(username, (r) => (r.cloud ? { ...r, cloud: { ...r.cloud, dirty: true } } : r));
    schedulePush();
  }
}

/**
 * Update the data. `deviceOnly` changes (like the notification log) are saved
 * locally but don't count as edits to sync.
 */
function set(updater: (prev: AppData) => AppData, { deviceOnly = false } = {}) {
  if (status !== 'signed-in') return;
  const next = updater(state);
  state = deviceOnly ? next : { ...next, updatedAt: Date.now() };
  emit();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persist(!deviceOnly || pendingDirty), 200);
  if (!deviceOnly) pendingDirty = true;
}
let pendingDirty = false;

/** Flush pending writes (e.g. when the app is backgrounded). */
export async function flush() {
  clearTimeout(saveTimer);
  await persist(pendingDirty);
  if (session?.cloud) await sync();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const usePhaseData = () => useSyncExternalStore(subscribe, () => state);
export const useAuthStatus = () => useSyncExternalStore(subscribe, () => status);
export const useSyncStatus = () => useSyncExternalStore(subscribe, () => syncStatus);
export const getState = () => state;
export const getSyncStatus = () => syncStatus;

/* ------------------------------------------------------------------ */
/* Sync engine                                                          */
/* ------------------------------------------------------------------ */

function schedulePush() {
  clearTimeout(pushTimer);
  if (syncStatus.state !== 'offline' && syncStatus.state !== 'signin') setSync({ state: 'pending' });
  pushTimer = setTimeout(() => void sync(), 1_500);
}

/** Get a server token, signing in again with the in-memory auth key if needed (e.g. after an offline sign-in). */
async function ensureToken(): Promise<string | null> {
  const c = session?.cloud;
  if (!c) return null;
  if (c.token) return c.token;
  if (!c.authKey) {
    setSync({ state: 'signin', message: 'Sign in again to sync your data.' });
    return null;
  }
  const res = await cloud.login(session!.username, c.authKey);
  c.token = res.token;
  const remembered = (await loadSession())?.username === session!.username;
  if (remembered) await saveSession({ username: session!.username, key: session!.key, token: res.token });
  return res.token;
}

async function decryptRemote(vault: EncryptedVault): Promise<AppData | null> {
  try {
    return migrate(await decryptJSON<AppData>(session!.key, vault));
  } catch {
    return null;
  }
}

/** Pull newer data from the server and push local changes. Safe to call any time. */
export function sync(): Promise<void> {
  if (!session?.cloud) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    const username = session!.username;
    try {
      const token = await ensureToken();
      if (!token) return;
      setSync({ state: 'syncing' });
      let rec = await record(username);
      if (!rec?.cloud) return;

      // 1. Pull anything newer.
      const remote = await cloud.getVault(token, rec.cloud.version);
      if (remote) {
        const data = await decryptRemote(remote.vault);
        if (!data) {
          setSync({ state: 'signin', message: 'Your password was changed on another device. Sign in again with the new password.' });
          return;
        }
        state = rec.cloud.dirty ? mergeData(state, data) : adoptRemote(state, data);
        emit();
        await persist(false);
        await updateRecord(username, (r) => ({ ...r, cloud: { version: remote.version, dirty: r.cloud!.dirty } }));
        rec = await record(username);
      }

      // 2. Push local changes (merging if another device got there first).
      for (let attempt = 0; rec?.cloud?.dirty && attempt < 4; attempt++) {
        const snapshot = state;
        try {
          const { version } = await cloud.putVault(token, await encryptJSON(session!.key, snapshot), rec.cloud.version);
          await updateRecord(username, (r) => ({ ...r, cloud: { version, dirty: state !== snapshot } }));
        } catch (e) {
          if (!(e instanceof CloudError) || e.status !== 409) throw e;
          const theirs = await decryptRemote(e.data.vault as EncryptedVault);
          if (!theirs) {
            setSync({ state: 'signin', message: 'Your password was changed on another device. Sign in again with the new password.' });
            return;
          }
          state = mergeData(state, theirs);
          emit();
          await persist(false);
          await updateRecord(username, (r) => ({ ...r, cloud: { version: Number(e.data.version), dirty: true } }));
        }
        rec = await record(username);
      }
      setSync(rec?.cloud?.dirty ? { state: 'pending' } : { state: 'synced', at: Date.now() });
    } catch (e) {
      if (e instanceof OfflineError) setSync({ state: 'offline' });
      else if (e instanceof CloudError && e.status === 401) {
        if (session?.cloud) session.cloud.token = undefined;
        setSync({ state: 'signin', message: 'Your session ended. Sign in again to keep syncing.' });
      } else setSync({ state: 'error', message: e instanceof Error ? e.message : 'Sync failed.' });
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** A server session token for the signed-in synced account (null for this-device-only accounts or when offline). */
export async function cloudToken(): Promise<string | null> {
  if (!session?.cloud) return null;
  try {
    return await ensureToken();
  } catch {
    return null;
  }
}

const onOnline = () => void sync();
const onVisible = () => document.visibilityState === 'visible' && void sync();

function startSyncLoop() {
  stopSyncLoop();
  if (typeof window === 'undefined') return;
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  pullTimer = setInterval(() => document.visibilityState === 'visible' && void sync(), 60_000);
}

function stopSyncLoop() {
  clearInterval(pullTimer);
  clearTimeout(pushTimer);
  if (typeof window === 'undefined') return;
  window.removeEventListener('online', onOnline);
  document.removeEventListener('visibilitychange', onVisible);
}

/* ------------------------------------------------------------------ */
/* Accounts                                                             */
/* ------------------------------------------------------------------ */

export class AuthError extends Error {}

export const normalizeUsername = (u: string) => u.trim().toLowerCase();

export function validateUsername(u: string): string | null {
  const n = normalizeUsername(u);
  if (n.length < 3) return 'Username needs at least 3 characters.';
  if (n.length > 32) return 'Username can be at most 32 characters.';
  if (!/^[a-z0-9._-]+$/.test(n)) return 'Use letters, numbers, dots, dashes or underscores.';
  return null;
}

export function passwordStrength(p: string): { score: 0 | 1 | 2 | 3; label: string; error: string | null } {
  if (p.length < 8) return { score: 0, label: 'Too short', error: 'Password needs at least 8 characters.' };
  let variety = 0;
  if (/[a-z]/.test(p)) variety++;
  if (/[A-Z]/.test(p)) variety++;
  if (/\d/.test(p)) variety++;
  if (/[^A-Za-z0-9]/.test(p)) variety++;
  const score = p.length >= 14 || variety >= 4 ? 3 : variety >= 3 || p.length >= 11 ? 2 : 1;
  return { score, label: ['Too short', 'Okay', 'Good', 'Strong'][score], error: null };
}

/** Local login throttling: 5 wrong passwords → 30s pause (the server has its own limits too). */
const failures = new Map<string, { count: number; until: number }>();
function checkThrottle(u: string) {
  const f = failures.get(u);
  if (f && f.until > Date.now()) {
    throw new AuthError(`Too many attempts. Try again in ${Math.ceil((f.until - Date.now()) / 1000)}s.`);
  }
}
function recordFailure(u: string) {
  const f = failures.get(u) ?? { count: 0, until: 0 };
  f.count++;
  if (f.count % 5 === 0) f.until = Date.now() + 30_000;
  failures.set(u, f);
}

const authError = (e: unknown) => {
  if (e instanceof AuthError) return e;
  if (e instanceof CloudError) return new AuthError(e.message);
  if (e instanceof OfflineError) return new AuthError('You’re offline. Connect to the internet and try again.');
  return new AuthError('Something went wrong. Please try again.');
};

async function startSession(s: Session, data: AppData, remember: boolean) {
  session = s;
  state = { ...data, username: s.username };
  status = 'signed-in';
  syncStatus = s.cloud ? { state: 'synced', at: Date.now() } : { state: 'local' };
  await saveLastUsername(s.username);
  if (remember) await saveSession({ username: s.username, key: s.key, token: s.cloud?.token });
  else await clearSession();
  emit();
  if (s.cloud) {
    startSyncLoop();
    void sync();
  }
}

/** Restore a remembered session on launch. */
export async function boot() {
  try {
    const s = await loadSession();
    if (s?.key && s.username) {
      const vault = await loadVault(s.username);
      const rec = await record(s.username);
      if (vault && rec) {
        const data = migrate(await decryptJSON<AppData>(s.key, vault));
        await startSession({ username: s.username, key: s.key, cloud: rec.cloud ? { token: s.token } : undefined }, data, true);
        return;
      }
    }
  } catch {
    await clearSession();
  }
  status = 'signed-out';
  emit();
}

export async function hasLegacyData() {
  return !!(await loadLegacyData())?.profile;
}

/** Info for the sign-in screen: is there a sync server, can people sign up, is an invite code needed. */
export async function serverInfo() {
  return cloud.health();
}

export async function register(usernameInput: string, password: string, remember: boolean, inviteCode?: string) {
  const username = normalizeUsername(usernameInput);
  const uErr = validateUsername(username);
  if (uErr) throw new AuthError(uErr);
  const pErr = passwordStrength(password).error;
  if (pErr) throw new AuthError(pErr);

  const accounts = await loadAccounts();
  if (accounts[username]) throw new AuthError('That username is already used on this device. Sign in instead.');
  // The first account on a device adopts any data saved before accounts existed.
  const legacy = Object.keys(accounts).length === 0 ? await loadLegacyData() : null;
  const base = legacy ?? emptyData();
  // New accounts see the intro tour once.
  const data: AppData = { ...base, username, updatedAt: Date.now(), settings: { ...base.settings, showIntro: true } };
  const server = await cloud.health(true);

  if (server) {
    if (!server.signup.open) throw new AuthError('Phase is full right now — no new accounts can be created.');
    const salt = toB64(random(16));
    const { encKey, authKey } = await deriveAccountKeys(password, salt, ACCOUNT_ITERATIONS);
    const vault = await encryptJSON(encKey, data);
    let res: { token: string; version: number };
    try {
      res = await cloud.register({ username, salt, iterations: ACCOUNT_ITERATIONS, authKey, inviteCode: inviteCode?.trim(), vault });
    } catch (e) {
      throw authError(e);
    }
    await saveVault(username, vault);
    await saveAccounts({ ...accounts, [username]: { username, salt, iterations: ACCOUNT_ITERATIONS, createdAt: Date.now(), cloud: { version: res.version, dirty: false } } });
    if (legacy) await clearLegacyData();
    await startSession({ username, key: encKey, cloud: { token: res.token, authKey } }, data, remember);
    return;
  }

  // No server: an account on this device only.
  const rec: AccountRecord = { username, salt: toB64(random(16)), iterations: VAULT_ITERATIONS, createdAt: Date.now() };
  const key = await deriveVaultKey(password, rec.salt, rec.iterations);
  await saveVault(username, await encryptJSON(key, data));
  await saveAccounts({ ...accounts, [username]: rec });
  if (legacy) await clearLegacyData();
  await startSession({ username, key }, data, remember);
}

export async function login(usernameInput: string, password: string, remember: boolean) {
  const username = normalizeUsername(usernameInput);
  checkThrottle(username);
  const local = await record(username);
  const server = await cloud.health(true);

  // Accounts that only exist on this device sign in locally.
  if (local && !local.cloud) return loginLocal(username, password, local, remember);

  if (server) {
    try {
      const { salt, iterations } = await cloud.prelogin(username);
      const { encKey, authKey } = await deriveAccountKeys(password, salt, iterations);
      const res = await cloud.login(username, authKey);
      let data: AppData = res.vault ? migrate(await decryptJSON<AppData>(encKey, res.vault)) : { ...emptyData(), username };
      let dirty = false;

      // This device's cached copy (if any): keeps device-only settings, and any
      // changes made offline that never reached the server.
      let cached: AppData | null = null;
      const cachedVault = local?.cloud ? await loadVault(username) : undefined;
      if (cachedVault) {
        try {
          cached = migrate(await decryptJSON<AppData>(encKey, cachedVault));
        } catch {
          /* cached copy used an older password — the server copy wins */
        }
      }
      if (cached && local?.cloud?.dirty) {
        data = mergeData(cached, data);
        dirty = true;
      } else {
        data = adoptRemote(cached ?? { ...emptyData(), username }, data);
      }
      await saveVault(username, await encryptJSON(encKey, data));
      const accounts = await loadAccounts();
      await saveAccounts({ ...accounts, [username]: { username, salt, iterations, createdAt: local?.createdAt ?? Date.now(), cloud: { version: res.version, dirty } } });
      failures.delete(username);
      await startSession({ username, key: encKey, cloud: { token: res.token, authKey } }, data, remember);
      return;
    } catch (e) {
      if (e instanceof CloudError && e.status === 401) recordFailure(username);
      if (!(e instanceof OfflineError)) throw authError(e);
      // Server unreachable mid-way: fall through to the offline copy.
    }
  }

  // Offline: use this device's encrypted copy of a synced account.
  if (local?.cloud) {
    const vault = await loadVault(username);
    const { encKey, authKey } = await deriveAccountKeys(password, local.salt, local.iterations);
    try {
      const data = migrate(await decryptJSON<AppData>(encKey, vault!));
      failures.delete(username);
      await startSession({ username, key: encKey, cloud: { authKey } }, data, remember);
      setSync({ state: 'offline' });
      return;
    } catch {
      recordFailure(username);
      throw new AuthError('Username or password is incorrect.');
    }
  }
  recordFailure(username);
  throw new AuthError(server ? 'Username or password is incorrect.' : 'You’re offline, and this account hasn’t been used on this device before. Connect to the internet to sign in.');
}

async function loginLocal(username: string, password: string, rec: AccountRecord, remember: boolean) {
  const vault = await loadVault(username);
  const key = await deriveVaultKey(password, rec.salt, rec.iterations);
  try {
    const data = migrate(await decryptJSON<AppData>(key, vault!));
    failures.delete(username);
    await startSession({ username, key }, data, remember);
  } catch {
    recordFailure(username);
    throw new AuthError('Username or password is incorrect.');
  }
}

export async function logout() {
  clearTimeout(saveTimer);
  await persist(pendingDirty);
  if (session?.cloud) {
    // Last chance to upload; don't wait long if offline.
    await Promise.race([sync(), new Promise((r) => setTimeout(r, 4_000))]);
    if (session.cloud.token) {
      // Stop sending this account's notifications to this device.
      await removePushSubscription(session.cloud.token).catch(() => undefined);
      await cloud.logout(session.cloud.token);
    }
  }
  stopSyncLoop();
  resetPushCache();
  await clearSession();
  session = null;
  state = emptyData();
  status = 'signed-out';
  syncStatus = { state: 'local' };
  emit();
}

/** Re-derive keys from a password and check it against this device's copy. */
async function verifyPassword(password: string): Promise<{ rec: AccountRecord; authKey?: string }> {
  if (!session) throw new AuthError('Not signed in.');
  const rec = await record(session.username);
  const vault = await loadVault(session.username);
  if (!rec || !vault) throw new AuthError('Account not found.');
  try {
    if (rec.cloud) {
      const { encKey, authKey } = await deriveAccountKeys(password, rec.salt, rec.iterations);
      await decryptJSON(encKey, vault);
      return { rec, authKey };
    }
    await decryptJSON(await deriveVaultKey(password, rec.salt, rec.iterations), vault);
    return { rec };
  } catch {
    throw new AuthError('Current password is incorrect.');
  }
}

export async function changePassword(current: string, next: string) {
  const pErr = passwordStrength(next).error;
  if (pErr) throw new AuthError(pErr);
  clearTimeout(saveTimer);
  await persist();
  const { rec, authKey } = await verifyPassword(current);
  const remembered = (await loadSession())?.username === rec.username;

  if (rec.cloud) {
    await sync();
    const token = await ensureToken().catch(() => null);
    if (!token || !authKey) throw new AuthError('You need to be online to change your password.');
    const salt = toB64(random(16));
    const keys = await deriveAccountKeys(next, salt, ACCOUNT_ITERATIONS);
    const vault = await encryptJSON(keys.encKey, state);
    let res: { token: string; version: number };
    try {
      res = await cloud.changePassword(token, { authKey, newSalt: salt, newIterations: ACCOUNT_ITERATIONS, newAuthKey: keys.authKey, vault });
    } catch (e) {
      throw authError(e);
    }
    await saveVault(rec.username, vault);
    await updateRecord(rec.username, (r) => ({ ...r, salt, iterations: ACCOUNT_ITERATIONS, cloud: { version: res.version, dirty: false } }));
    session = { username: rec.username, key: keys.encKey, cloud: { token: res.token, authKey: keys.authKey } };
    if (remembered) await saveSession({ username: rec.username, key: keys.encKey, token: res.token });
    setSync({ state: 'synced', at: Date.now() });
    return;
  }

  const updated: AccountRecord = { ...rec, salt: toB64(random(16)), iterations: VAULT_ITERATIONS };
  const key = await deriveVaultKey(next, updated.salt, updated.iterations);
  await saveVault(rec.username, await encryptJSON(key, state));
  await updateRecord(rec.username, () => updated);
  session = { username: rec.username, key };
  if (remembered) await saveSession({ username: rec.username, key });
}

/** Move a this-device-only account onto the sync server, keeping all its data. */
export async function enableSync(password: string, inviteCode?: string) {
  const { rec } = await verifyPassword(password);
  if (rec.cloud) return;
  const server = await cloud.health(true);
  if (!server) throw new AuthError('Can’t reach the Phase server right now.');
  if (!server.signup.open) throw new AuthError('Phase is full right now — no new accounts can be created.');
  clearTimeout(saveTimer);
  const salt = toB64(random(16));
  const keys = await deriveAccountKeys(password, salt, ACCOUNT_ITERATIONS);
  const data = { ...state, updatedAt: Date.now() };
  const vault = await encryptJSON(keys.encKey, data);
  let res: { token: string; version: number };
  try {
    res = await cloud.register({ username: rec.username, salt, iterations: ACCOUNT_ITERATIONS, authKey: keys.authKey, inviteCode: inviteCode?.trim(), vault });
  } catch (e) {
    if (e instanceof CloudError && e.status === 409) throw new AuthError('Someone already uses that username on the server. Create a new account with a different username, then import a backup.');
    throw authError(e);
  }
  await saveVault(rec.username, vault);
  await updateRecord(rec.username, (r) => ({ ...r, salt, iterations: ACCOUNT_ITERATIONS, cloud: { version: res.version, dirty: false } }));
  const remembered = (await loadSession())?.username === rec.username;
  session = { username: rec.username, key: keys.encKey, cloud: { token: res.token, authKey: keys.authKey } };
  if (remembered) await saveSession({ username: rec.username, key: keys.encKey, token: res.token });
  state = data;
  startSyncLoop();
  setSync({ state: 'synced', at: Date.now() });
}

/** Sign in again after "signin" sync status (e.g. password changed on another device). */
export async function reauthenticate(password: string) {
  if (!session) return;
  const username = session.username;
  const remember = (await loadSession())?.username === username;
  stopSyncLoop();
  try {
    await login(username, password, remember);
  } catch (e) {
    if (session) startSyncLoop();
    throw e;
  }
  await sync();
}

export async function deleteAccount(password: string) {
  if (!session) throw new AuthError('Not signed in.');
  const rec = await record(session.username);
  if (rec?.cloud) {
    let authKey: string;
    try {
      const { salt, iterations } = await cloud.prelogin(rec.username);
      authKey = (await deriveAccountKeys(password, salt, iterations)).authKey;
      const token = await ensureToken();
      if (!token) throw new AuthError('Sign in again before deleting your account.');
      await cloud.deleteAccount(token, authKey);
    } catch (e) {
      throw authError(e);
    }
  } else {
    await verifyPassword(password);
  }
  clearTimeout(saveTimer);
  stopSyncLoop();
  const accounts = await loadAccounts();
  delete accounts[session.username];
  await saveAccounts(accounts);
  await deleteVault(session.username);
  await clearSession();
  session = null;
  state = emptyData();
  status = 'signed-out';
  syncStatus = { state: 'local' };
  emit();
}

/* ------------------------------------------------------------------ */
/* Actions                                                              */
/* ------------------------------------------------------------------ */

export const blankLog = (date: ISODate, isPeriodDay = false): DailyLog => ({
  date,
  cycle: { isPeriodDay },
  symptoms: { moods: [] },
  lifestyle: { medications: [] },
  updatedAt: Date.now(),
});

const range = (start: ISODate, end: ISODate): ISODate[] => {
  const n = Math.max(0, diffDays(end, start));
  return Array.from({ length: n + 1 }, (_, i) => addDays(start, i));
};

export function completeOnboarding(profile: Demographics, periodStart: ISODate, periodEnd: ISODate) {
  set((s) => ({
    ...s,
    profile,
    periodDays: [...new Set([...s.periodDays, ...range(periodStart, periodEnd)])].sort(),
  }));
}

export function updateProfile(patch: Partial<Demographics>) {
  set((s) => (s.profile ? { ...s, profile: { ...s.profile, ...patch } } : s));
}

export function setPeriodDay(date: ISODate, isPeriod: boolean) {
  set((s) => {
    const days = new Set(s.periodDays);
    if (isPeriod) days.add(date);
    else days.delete(date);
    const log = s.logs[date] ?? blankLog(date, s.periodDays.includes(date));
    return {
      ...s,
      periodDays: [...days].sort(),
      logs: { ...s.logs, [date]: { ...log, cycle: { ...log.cycle, isPeriodDay: isPeriod }, updatedAt: Date.now() } },
    };
  });
}

/** Merge a partial log into the day's log, keeping periodDays in sync. */
export function saveLog(date: ISODate, patch: (prev: DailyLog) => DailyLog) {
  set((s) => {
    const next = { ...patch(s.logs[date] ?? blankLog(date, s.periodDays.includes(date))), date, updatedAt: Date.now() };
    const days = new Set(s.periodDays);
    if (next.cycle.isPeriodDay) days.add(date);
    else days.delete(date);
    return { ...s, periodDays: [...days].sort(), logs: { ...s.logs, [date]: next } };
  });
}

/** Apply what the natural-language parser understood. */
export function applyParsed(date: ISODate, parsed: ParsedLog, note: string) {
  saveLog(date, (prev) => {
    const moods = parsed.symptoms.moods ? [...new Set([...prev.symptoms.moods, ...parsed.symptoms.moods])] : prev.symptoms.moods;
    const meds = parsed.lifestyle.medications
      ? [...new Set([...prev.lifestyle.medications, ...parsed.lifestyle.medications])]
      : prev.lifestyle.medications;
    const isPeriodDay = parsed.isPeriodDay ?? prev.cycle.isPeriodDay;
    return {
      ...prev,
      cycle: {
        ...prev.cycle,
        isPeriodDay,
        flow: parsed.flow && parsed.flow !== 'spotting' ? parsed.flow : prev.cycle.flow,
        intermenstrualSpotting: parsed.flow === 'spotting' && !isPeriodDay ? true : prev.cycle.intermenstrualSpotting,
      },
      symptoms: { ...prev.symptoms, ...parsed.symptoms, moods },
      lifestyle: { ...prev.lifestyle, ...parsed.lifestyle, medications: meds },
      note: [prev.note, note].filter(Boolean).join('\n'),
    };
  });
}

const DEVICE_ONLY_SETTINGS: (keyof Settings)[] = ['lockEnabled', 'pinHash', 'pinSalt', 'biometricCredentialId', 'installBannerDismissedAt'];

export function updateSettings(patch: Partial<Settings>) {
  const deviceOnly = Object.keys(patch).every((k) => DEVICE_ONLY_SETTINGS.includes(k as keyof Settings));
  set((s) => ({ ...s, settings: { ...s.settings, ...patch } }), { deviceOnly });
}

export function importData(raw: unknown) {
  const imported = migrate(raw);
  if (!imported.profile) throw new Error('This file does not look like a Phase export.');
  // Keep this device's lock settings.
  set((s) => ({ ...imported, username: s.username, settings: { ...imported.settings, ...pickLock(s.settings) } }));
}

const pickLock = ({ lockEnabled, pinHash, pinSalt, biometricCredentialId }: Settings) => ({
  lockEnabled,
  pinHash,
  pinSalt,
  biometricCredentialId,
});

/** Development helper: replace the current account's data with sample cycles. */
export function loadDemoData(demo: AppData) {
  set((s) => ({ ...demo, username: s.username, settings: s.settings }));
}

/** "Understand your symptoms" → save the selection into a day's log. */
export function applySymptomLog(date: ISODate, apply: (prev: DailyLog) => DailyLog) {
  saveLog(date, apply);
}

/** Remember which notifications were sent or planned (no-op if unchanged). */
export function setNotificationLog(next: Record<string, number>) {
  set((s) => ({ ...s, notificationLog: next }), { deviceOnly: true });
}

export function updateNotificationSettings(patch: Partial<NotificationSettings>) {
  set(
    (s) => ({
      ...s,
      settings: { ...s.settings, notifications: { ...DEFAULT_NOTIFICATION_SETTINGS, ...s.settings.notifications, ...patch } },
    }),
    { deviceOnly: true },
  );
}
