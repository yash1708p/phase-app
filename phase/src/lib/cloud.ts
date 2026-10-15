/**
 * Client for the Phase sync server (server/app.ts).
 *
 * Everything sent here about health data is already encrypted on the device.
 * The server URL defaults to the same site the app is served from; set
 * VITE_API_URL at build time to point somewhere else (e.g. for the iOS/Android
 * app builds, which aren't served from your domain).
 */
import type { EncryptedVault } from '../types';

const BASE = `${(import.meta.env?.VITE_API_URL ?? '').replace(/\/$/, '')}/api`;

export class CloudError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Thrown when the server can't be reached (offline, or no server deployed). */
export class OfflineError extends Error {}

export async function call<T>(path: string, opts: { method?: string; body?: unknown; token?: string; timeoutMs?: number } = {}): Promise<{ status: number; data: T }> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000) : undefined;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl?.signal,
    });
  } catch {
    throw new OfflineError('Can’t reach the Phase server.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return { status: 204, data: undefined as T };
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    // A static host with no server answers /api/* with HTML or 404.
    throw new OfflineError('No Phase server here.');
  }
  if (!res.ok) throw new CloudError(String(data.error ?? 'Something went wrong.'), res.status, data);
  return { status: res.status, data: data as T };
}

export interface Health {
  ok: true;
  signup: { open: boolean; codeRequired: boolean };
}

let healthCache: { at: number; value: Health | null } | null = null;

/** Server info, or null when there's no reachable server (offline, or a static-only deployment). */
export async function health(force = false): Promise<Health | null> {
  if (!force && healthCache && Date.now() - healthCache.at < 30_000) return healthCache.value;
  let value: Health | null = null;
  try {
    const { data } = await call<Health>('/health', { timeoutMs: 5_000 });
    value = data?.ok ? data : null;
  } catch {
    value = null;
  }
  healthCache = { at: Date.now(), value };
  return value;
}

export const resetHealthCache = () => (healthCache = null);

export const prelogin = (username: string) => call<{ salt: string; iterations: number }>('/prelogin', { body: { username } }).then((r) => r.data);

export const register = (body: { username: string; salt: string; iterations: number; authKey: string; inviteCode?: string; vault: EncryptedVault }) =>
  call<{ token: string; version: number }>('/register', { body }).then((r) => r.data);

export const login = (username: string, authKey: string) =>
  call<{ token: string; vault: EncryptedVault | null; version: number }>('/login', { body: { username, authKey } }).then((r) => r.data);

export const logout = (token: string) => call('/logout', { method: 'POST', body: {}, token, timeoutMs: 4_000 }).catch(() => undefined);

/** Returns null when nothing changed since `since`. */
export const getVault = (token: string, since?: number) =>
  call<{ vault: EncryptedVault; version: number }>(`/vault${since !== undefined ? `?since=${since}` : ''}`, { token }).then((r) => (r.status === 204 ? null : r.data));

export const putVault = (token: string, vault: EncryptedVault, baseVersion: number) =>
  call<{ version: number }>('/vault', { method: 'PUT', body: { vault, baseVersion }, token }).then((r) => r.data);

export const changePassword = (token: string, body: { authKey: string; newSalt: string; newIterations: number; newAuthKey: string; vault: EncryptedVault }) =>
  call<{ token: string; version: number }>('/password', { body, token }).then((r) => r.data);

export const deleteAccount = (token: string, authKey: string) => call('/account', { method: 'DELETE', body: { authKey }, token });
