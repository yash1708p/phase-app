/**
 * Database tables for the Phase server (SQLite / Cloudflare D1).
 * Created automatically on first run — no manual setup needed.
 */
export const SCHEMA = `
-- Phase sync server schema (SQLite / Cloudflare D1).
-- The server never sees passwords or health data: it stores a hash of a key
-- derived on the device, and each user's data as an encrypted blob.

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT    NOT NULL UNIQUE,
  salt        TEXT    NOT NULL,          -- client-side key-derivation salt (not secret)
  iterations  INTEGER NOT NULL,          -- client-side PBKDF2 iterations
  auth_hash   TEXT    NOT NULL,          -- SHA-256 of the client's auth key
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vaults (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  iv          TEXT    NOT NULL,
  ciphertext  TEXT    NOT NULL,          -- AES-GCM, encrypted on the device
  version     INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT    PRIMARY KEY,       -- SHA-256 of the bearer token
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS rate_limits (
  key         TEXT    PRIMARY KEY,       -- e.g. "login-user:maya", "login-ip:1.2.3.4"
  count       INTEGER NOT NULL,
  reset_at    INTEGER NOT NULL
);

-- Server settings generated on first run (e.g. the push-notification keys).
CREATE TABLE IF NOT EXISTS config (
  key         TEXT    PRIMARY KEY,
  value       TEXT    NOT NULL
);

-- One row per device that turned on notifications.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT    NOT NULL UNIQUE,   -- the phone's push address (Apple/Google/Mozilla)
  created_at  INTEGER NOT NULL
);

-- Notifications waiting to be sent. The payload is encrypted on the phone
-- for that phone only — the server just delivers it at \`send_at\`.
CREATE TABLE IF NOT EXISTS push_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  send_at         INTEGER NOT NULL,
  payload         TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS push_queue_due ON push_queue(send_at);

-- The latest delivery result for each device (shown in the app's notification check).
CREATE TABLE IF NOT EXISTS push_results (
  subscription_id INTEGER PRIMARY KEY REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  at              INTEGER NOT NULL,
  status          INTEGER NOT NULL,       -- HTTP status from Apple/Google/Mozilla (0 = couldn't reach it)
  reason          TEXT
);
`;
