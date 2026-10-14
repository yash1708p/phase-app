# Phase sync server

The server lets people sign in on **any device** with their username and password and see the same data. It's built for a small, invite-only group.

## How it keeps data private

- The password never leaves the phone. The phone turns it into two keys:
  - an **encryption key**, which stays on the device and encrypts all of the user's data;
  - an **auth key**, which is sent to the server to prove the password is right.
- The server stores only a hash of the auth key and each user's data as an **encrypted blob it can't read**. A server breach or a curious server admin sees usernames and sign-up dates, nothing else.
- The trade-off is that **a forgotten password can't be reset**: without it, the data can't be decrypted. Users should export a backup now and then (Settings → Export).

## Limiting who can sign up

| Setting | What it does |
|---|---|
| `SIGNUP_CODE` | An invite code people must enter to create an account. Share it only with people you want to invite, and change it whenever you like. Existing accounts aren't affected. |
| `MAX_USERS` | Maximum number of accounts (default 25). When it's reached, sign-up closes automatically. |

## What the app does

- **Sign in anywhere.** On a new phone or computer, sign in and the data downloads.
- **Works offline.** Each device keeps an encrypted copy. Changes made offline upload when the device is back online.
- **Two devices at once.** If both change things before syncing, the edits are merged: for each day, the most recently edited log wins.
- **Device-only settings stay put.** The PIN lock, Face ID / fingerprint, and notification settings aren't copied between devices.
- **Notifications arrive even when Phase is closed** (home-screen web app, signed in). See docs/NOTIFICATIONS.md.
- **Changing the password** signs out every other device. Those devices ask for the new password the next time they sync.
- **Settings → Account** shows the sync status, a *Sync now* button, and *Turn on sync* for accounts created before the server existed.
- **Limits:** 5 wrong passwords on a device → 30-second pause. On the server, 10 wrong passwords for a username → 15-minute lock. Sessions last 60 days.

If the app is deployed **without** the server (plain static hosting), it automatically falls back to this-device-only accounts, as before.

---

## Deploying

**Recommended (all free):** keep the app on Vercel and run the server on Cloudflare Workers + D1. **docs/DEPLOY.md** has every step, using only the GitHub, Cloudflare and Vercel websites.

- `wrangler.toml` — the Worker (`server/worker.ts`), its D1 database binding, and a cron trigger that runs every minute to send notifications.
- `vercel.json` — forwards `/api/*` from your Vercel address to the Worker, so the app and the server share one address (no CORS, no extra settings in the app).
- The server creates its database tables, its secret and its push (VAPID) keys **by itself on first run**. The only thing to set is the invite code (`SIGNUP_CODE`).

## Option B — Any Node.js host

This option works on a VPS, a home server or Raspberry Pi, or any host with **Node 22.5+** and a disk that persists between restarts.

```bash
npm install
npm run build
SIGNUP_CODE="sunflower-2026" MAX_USERS=25 npm run server
```

- It serves the app and the API on port 8787 (set `PORT` to change it).
- Data goes in `data/phase.db` (set `DB_PATH` to change it). Back up this one file.
- It also sends due notifications every minute while running.
- Put it behind HTTPS (for example Caddy or your host's built-in HTTPS). Logins, the service worker and notifications all need HTTPS.

**Managing accounts (Node):**

```bash
npm run admin -- list               # usernames and sign-up dates
npm run admin -- delete <username>  # remove an account and all of its data
npm run admin -- signout <username> # sign someone out on every device
```

## The iPhone / Android app builds

The app builds load the web app from inside the app, so they need to know where the server is. Build them with:

```bash
VITE_API_URL="https://phase.<you>.workers.dev" npm run cap:sync
```

## API (for reference)

All endpoints are under `/api`. Health data only ever appears as `{ iv, ciphertext }` encrypted on the device.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Is sign-up open, and is an invite code needed |
| POST | `/prelogin` | Salt and iteration count for a username (fake but stable for unknown names) |
| POST | `/register` | Create an account (invite code, account limit) |
| POST | `/login` | Check the auth key and return a session plus the encrypted data |
| GET | `/vault?since=N` | Download the data if newer than version N |
| PUT | `/vault` | Upload data (`409` with the newer copy if another device got there first) |
| POST | `/password` | Change password (re-encrypted data; signs out other devices) |
| DELETE | `/account` | Delete the account and its data |
| GET | `/push/key` | Public VAPID key for subscribing a device |
| POST / DELETE | `/push/subscribe` | Register or remove this device's push address |
| PUT | `/push/schedule` | Replace this device's upcoming notifications (each encrypted on the device) |
| POST | `/push/test` | Send one encrypted test notification now |
| POST | `/logout` | End this device's session |
