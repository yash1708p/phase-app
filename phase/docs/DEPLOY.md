# Putting Phase online: step by step

Everything here is free:

| Piece | Where | What it does |
|---|---|---|
| The app | **Vercel** (as before) | Serves Phase to phones and computers |
| Accounts, sync, notifications | **Cloudflare Workers** (free plan) | Lets people sign in on any device, and sends notifications even when Phase is closed |
| Database | **Cloudflare D1** (free plan) | Stores accounts, and data that's **encrypted on the phone** (unreadable by the server) |
| Your code | **GitHub** (as before) | Both Vercel and Cloudflare update automatically when you change it |

You only use websites. No command line is needed. Allow about 20–30 minutes the first time.

---

## Part 1 — Put the new code on GitHub

1. Download **phase.zip** and unzip it. You get a folder called `phase`.
2. Replace the files in your GitHub repository with the files **inside** that `phase` folder. Either way works:
   - **GitHub Desktop (easiest, free app):** open your repository and choose *Show in Finder/Explorer*. Copy everything from inside the new `phase` folder into it, replacing files when asked. Back in GitHub Desktop, type a summary such as "Add sync and notifications", click **Commit to main**, then **Push origin**.
   - **github.com in the browser:** open your repository → **Add file → Upload files** → drag in the contents of the `phase` folder → **Commit changes**. The browser accepts about 100 files per upload. If it complains, upload the `src` folder in one go and everything else in a second go.
3. Vercel notices the change and redeploys. That's fine: the app keeps working as it did, until Part 3 connects it to the server.

## Part 2 — Set up the free server on Cloudflare

### 2a. Create an account

1. Go to **dash.cloudflare.com** and sign up (free, no card needed).

### 2b. Create the database

1. In the left menu, open **Storage & databases → D1 SQL database**.
2. Click **Create database**, name it `phase`, and click **Create**.
3. On the database page, copy the **Database ID** (a long code like `a1b2c3d4-…`).
4. On GitHub, open the file `wrangler.toml` in your repository and click the ✏️ pencil to edit it.
5. Replace `PASTE_YOUR_DATABASE_ID_HERE` with the ID you copied, keeping the quotes, then click **Commit changes**.

You don't need to create any tables; the server does that by itself the first time it runs.

### 2c. Connect the server to your GitHub repository

1. In Cloudflare's left menu, open **Workers & Pages** and click **Create**.
2. Choose **Import a repository** (sometimes shown as *Connect to Git*), connect your GitHub account, and pick your Phase repository.
3. On the setup screen:
   - **Project / Worker name:** `phase-api` (it must match the `name` in `wrangler.toml`).
   - **Build command:** leave it empty.
   - **Deploy command:** `npx wrangler deploy`.
   - **Root directory:** leave it as `/`.
4. Click **Deploy**. When it finishes, Cloudflare shows your server's address, which looks like `https://phase-api.YOUR-NAME.workers.dev`. Copy it.
5. Check it works: open `https://phase-api.YOUR-NAME.workers.dev/api/health` in your browser. You should see `{"ok":true,…}`.

### 2d. Set your invite code

1. In Cloudflare, open your `phase-api` Worker → **Settings → Variables and Secrets** → **Add**.
2. Type: **Secret**. Name: `SIGNUP_CODE`. Value: the invite code you'll give your users (for example `sunflower-2026`). Click **Deploy** / **Save**.
3. The account limit is 25 by default. To change it, edit `MAX_USERS` in `wrangler.toml` on GitHub.

The server sends due notifications every minute by itself. This comes from `wrangler.toml`, and you'll see it under the Worker's **Settings → Trigger events** (*Cron: every minute*).

## Part 3 — Connect the app on Vercel to the server

1. On GitHub, open `vercel.json` and click the ✏️ pencil.
2. Replace `https://phase-api.YOUR-SUBDOMAIN.workers.dev` with your address from Part 2c, keeping `/api/:path*` on the end. For example:

   ```json
   "destination": "https://phase-api.maya-smith.workers.dev/api/:path*"
   ```

3. Click **Commit changes**. Vercel redeploys automatically in a minute or two.
4. Check it: open `https://YOUR-APP.vercel.app/api/health`. You should see the same `{"ok":true,…}` message as before.

Your Vercel settings don't change: Framework *Vite*, Build command `npm run build`, Output directory `dist`.

## Part 4 — Try it yourself first

1. On your phone, open `https://YOUR-APP.vercel.app`:
   - **iPhone:** in **Safari**, tap **Share** (the square with an arrow) → **Add to Home Screen** → **Add**. This needs iOS 16.4 or later.
   - **Android:** in **Chrome**, tap **⋮** → **Add to Home screen** (or **Install app**).
2. **Open Phase from the new home-screen icon**, not from the browser. On iPhone, notifications only work this way.
3. Tap **Create account**, choose a username and password, and enter your invite code.
4. Go to **⚙ Settings → Notifications** and turn them on, then tap **Allow**. You should see *"Notifications on this device arrive even when Phase is closed."*
5. Tap **Send a test**, then lock your phone. It should arrive within a few seconds.
6. Tap **Check notifications**. Every line should have a green tick. If one doesn't, it says exactly what to fix.
6. To try another device, open the same link on a computer or second phone and **Sign in** with the same username and password. Your data appears there too.

## Part 5 — Invite your users

Send them a message like this (fill in your link and code):

> Hi! Here's Phase, a private period & cycle tracker 🌸
>
> 1. Open **https://YOUR-APP.vercel.app** on your phone (iPhone: use Safari).
> 2. Add it to your home screen. On iPhone: Share → *Add to Home Screen*. On Android: ⋮ → *Add to Home screen*.
> 3. Open Phase from the home-screen icon and tap **Create account**.
> 4. Invite code: **sunflower-2026**
> 5. In Settings, turn on **Notifications** and tap **Allow**.
>
> You can sign in on any other device with the same username and password. Your data is encrypted on your phone, so nobody else can read it. There's no password reset, so pick a password you'll remember.

**People who already used the earlier version on this site** keep their data. They open **Settings → Account → Turn on sync** and enter their password and the invite code. That moves their data onto the server so they can sign in anywhere.

---

## Everyday management

| To… | Do this |
|---|---|
| Change the invite code | Cloudflare → `phase-api` → Settings → Variables and Secrets → edit `SIGNUP_CODE`. Existing accounts aren't affected. |
| Allow more accounts | Edit `MAX_USERS` in `wrangler.toml` on GitHub. |
| See who has an account | Cloudflare → D1 → `phase` → **Console**, run: `SELECT username, datetime(created_at/1000,'unixepoch') AS joined FROM users;` |
| Delete an account | Same console, replacing NAME in each line: `DELETE FROM push_subscriptions WHERE user_id=(SELECT id FROM users WHERE username='NAME'); DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username='NAME'); DELETE FROM vaults WHERE user_id=(SELECT id FROM users WHERE username='NAME'); DELETE FROM users WHERE username='NAME';` This removes the person's data, sessions and notifications. |
| Update the app | Put new code on GitHub (Part 1). Vercel and Cloudflare both redeploy by themselves. |

## Costs and limits (all free)

- **Vercel Hobby:** hosts the app, the same as before.
- **Cloudflare Workers Free:** 100,000 requests a day. The every-minute notification check uses about 1,440 of those, leaving plenty for a group of 25.
- **Cloudflare D1 Free:** small encrypted records for a small group fit easily.
- **Notifications** go through Apple's, Google's or Mozilla's own free push services.

No credit card is needed for any of these.

## If something doesn't work

| Problem | Fix |
|---|---|
| `/api/health` on Vercel shows the app instead of `{"ok":true}` | `vercel.json` still has `YOUR-SUBDOMAIN`, or the address has a typo (Part 3). |
| Cloudflare deploy fails, mentioning the database | The Database ID in `wrangler.toml` is missing or wrong (Part 2b). |
| Cloudflare deploy fails, mentioning the name | The Worker must be called `phase-api`, the same as in `wrangler.toml` (Part 2c). |
| "That invite code isn't right" | Check `SIGNUP_CODE` in Cloudflare (Part 2d). It's case-sensitive. |
| Notifications show under *Coming up* but never arrive | In Settings → Notifications tap **Check notifications** and fix the first line with a red cross. The most common causes: the account was created while the server wasn't connected yet, so it's *stored on this device only* (Settings → Account → **Turn on sync**); Phase was opened from Safari instead of the home-screen icon; or the Cloudflare **Cron trigger** is missing (Workers & Pages → phase-api → Settings → Trigger events → add Cron `* * * * *`). |
| Check notifications says "Server up to date" failed | The Cloudflare server is running an older version. Make sure the latest code is on GitHub, then in Cloudflare open phase-api → Deployments and check the newest build succeeded. |
| Settings says notifications only arrive while Phase is open | On iPhone, Phase must be opened from the **home-screen icon**, and the person must be **signed in** with a synced account. Turn notifications off and on again in Settings. |
| No notifications on iPhone | iPhone Settings → Notifications → **Phase** → Allow Notifications. Also check that Focus / Do Not Disturb isn't on. |
