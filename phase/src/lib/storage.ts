/**
 * On-device persistence.
 *
 * Layout (IndexedDB object store "kv"):
 *   accounts            Record<username, AccountRecord>      (no secrets)
 *   vault:<username>    EncryptedVault                       (AES-GCM, password-derived key)
 *   session             { username, key: CryptoKey }         ("keep me signed in"; key is non-extractable)
 *   app-data            legacy unencrypted data from v1 — migrated into the first account, then deleted
 *
 * If IndexedDB is unavailable (some private modes), values fall back to
 * localStorage. CryptoKeys can't be stored there, so sessions aren't
 * remembered in that case — the user simply signs in each time.
 * Nothing is ever sent over the network.
 */
import type { AccountRecord, AppData, EncryptedVault, Settings } from '../types';

const DB_NAME = 'phase';
const STORE = 'kv';
const LS_PREFIX = 'phase:';

export const DEFAULT_SETTINGS: Settings = { lockEnabled: false, tempUnit: 'C' };

export const emptyData = (): AppData => ({
  schemaVersion: 1,
  profile: null,
  periodDays: [],
  logs: {},
  settings: { ...DEFAULT_SETTINGS },
});

/* ------------------------------------------------------------------ */
/* Key-value layer                                                      */
/* ------------------------------------------------------------------ */

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    const v = await idb<T | undefined>('readonly', (s) => s.get(key));
    if (v !== undefined) return v;
  } catch {
    /* fall back */
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Returns false if the value could not be persisted anywhere. */
async function kvSet(key: string, value: unknown, { idbOnly = false } = {}): Promise<boolean> {
  try {
    await idb('readwrite', (s) => s.put(value, key));
    try {
      localStorage.removeItem(LS_PREFIX + key);
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    if (idbOnly) return false;
  }
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('[Phase] Could not persist', key, err);
    return false;
  }
}

async function kvDel(key: string) {
  try {
    await idb('readwrite', (s) => s.delete(key));
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(LS_PREFIX + key);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Accounts, vaults, session                                            */
/* ------------------------------------------------------------------ */

export const loadAccounts = async () => (await kvGet<Record<string, AccountRecord>>('accounts')) ?? {};
export const saveAccounts = (a: Record<string, AccountRecord>) => kvSet('accounts', a);

export const loadVault = (username: string) => kvGet<EncryptedVault>(`vault:${username}`);
export const saveVault = (username: string, v: EncryptedVault) => kvSet(`vault:${username}`, v);
export const deleteVault = (username: string) => kvDel(`vault:${username}`);

export interface StoredSession {
  username: string;
  key: CryptoKey;
  /** Sync server session token (synced accounts only). */
  token?: string;
}
export const loadSession = () => kvGet<StoredSession>('session');
export const saveSession = (s: StoredSession) => kvSet('session', s, { idbOnly: true });
export const clearSession = () => kvDel('session');

export const loadLastUsername = () => kvGet<string>('last-username');
export const saveLastUsername = (u: string) => kvSet('last-username', u);

/** Data saved by Phase v1 before accounts existed. */
export async function loadLegacyData(): Promise<AppData | null> {
  const legacy = await kvGet<unknown>('app-data');
  return legacy ? migrate(legacy) : null;
}
export const clearLegacyData = () => kvDel('app-data');

/* ------------------------------------------------------------------ */
/* Schema                                                               */
/* ------------------------------------------------------------------ */

/** Fill in any fields added in later versions so old data keeps working. */
export function migrate(raw: unknown): AppData {
  const base = emptyData();
  if (!raw || typeof raw !== 'object') return base;
  const d = raw as Partial<AppData>;
  // Face ID / fingerprint unlock was removed: drop its old credential id.
  const { biometricCredentialId: _bio, ...settings } = (d.settings ?? {}) as Partial<AppData['settings']> & { biometricCredentialId?: string };
  return {
    schemaVersion: 1,
    username: typeof d.username === 'string' ? d.username : undefined,
    profile: d.profile ?? null,
    periodDays: Array.isArray(d.periodDays) ? d.periodDays.filter((x) => typeof x === 'string') : [],
    logs: d.logs && typeof d.logs === 'object' ? d.logs : {},
    settings: { ...DEFAULT_SETTINGS, ...settings },
    notificationLog: d.notificationLog && typeof d.notificationLog === 'object' ? d.notificationLog : {},
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : undefined,
  };
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Export logs as JSON. Lock secrets are never included in the export. */
export function exportJSON(data: AppData): Blob {
  const { pinHash: _h, pinSalt: _s, ...safeSettings } = data.settings;
  const payload = { ...data, settings: { ...safeSettings, lockEnabled: false }, exportedAt: new Date().toISOString() };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}
