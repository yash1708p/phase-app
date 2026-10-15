/**
 * Security primitives.
 *
 * - Account vaults: each account's data is encrypted with AES-GCM using a key
 *   derived from the account password (PBKDF2-SHA256). The key is created as
 *   non-extractable, so even a remembered session cannot leak raw key bytes.
 * - App lock: a 4-digit PIN (PBKDF2-hashed, salted). This is a quick privacy
 *   screen on top of a remembered session; the password-derived key is what
 *   protects the data.
 */

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

export const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export async function hashPin(pin: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltB64 ? fromB64(saltB64) : random(16);
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150_000 }, key, 256);
  return { hash: toB64(bits), salt: toB64(salt) };
}

export async function verifyPin(pin: string, hash: string, salt: string): Promise<boolean> {
  const { hash: candidate } = await hashPin(pin, salt);
  // Constant-time-ish comparison.
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/* Account vault encryption                                             */
/* ------------------------------------------------------------------ */

export const VAULT_ITERATIONS = 210_000;

export async function deriveVaultKey(password: string, saltB64: string, iterations = VAULT_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJSON(key: CryptoKey, value: unknown): Promise<{ iv: string; ciphertext: string }> {
  const iv = random(12);
  const data = enc.encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: toB64(iv), ciphertext: toB64(ct) };
}

/** Throws if the key is wrong (AES-GCM authentication fails). */
export async function decryptJSON<T>(key: CryptoKey, vault: { iv: string; ciphertext: string }): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(vault.iv) }, key, fromB64(vault.ciphertext));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

/* ------------------------------------------------------------------ */
/* Synced accounts: one password → two independent keys                */
/* ------------------------------------------------------------------ */

export const ACCOUNT_ITERATIONS = 310_000;

/**
 * Derives 512 bits from the password. The first half becomes the AES-GCM
 * key that encrypts the user's data (never leaves the device, non-extractable);
 * the second half is the "auth key" sent to the server to prove the password.
 * Knowing the auth key doesn't reveal the encryption key, so the server can
 * verify logins without ever being able to read anyone's data.
 */
export async function deriveAccountKeys(password: string, saltB64: string, iterations = ACCOUNT_ITERATIONS): Promise<{ encKey: CryptoKey; authKey: string }> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations }, base, 512));
  const encKey = await crypto.subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { encKey, authKey: toB64(bits.slice(32)) };
}
