# Phase — Period & Ovulation Tracker (PWA)

A private cycle tracker for mobile browsers. React + Vite + TypeScript + Tailwind, installable as a PWA, works offline, and can be wrapped as an iOS/Android app for home-screen widgets. An optional, invite-only sync server lets people sign in on any device, with end-to-end encryption, so the server can't read anyone's data. No analytics.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 100 tests, including the server, push encryption and a two-device sync scenario
npm run build      # type-check + production build with service worker → dist/
npm run preview    # serve the production build (test install/offline here)
npm run icons      # regenerate PNG icons (needs Python + Pillow)
npm run cap:sync   # build and copy into the iOS/Android apps (see docs/WIDGETS.md)
npm run server     # run app + sync server on Node (see docs/SERVER.md)
npm run deploy:cloudflare   # deploy the server to Cloudflare from the command line (optional; docs/DEPLOY.md does it from the website)
```

In development, sign in and open `/?demo=1` (or Settings → “Load sample data”) to fill the account with six realistic cycles.

Deploy `dist/` to any static host over **HTTPS** (Netlify, Vercel, Cloudflare Pages, S3+CloudFront). Service workers and install prompts require HTTPS. Configure the host to serve `index.html` for unknown routes.

## Project structure

```
public/
  manifest.json            Web App Manifest for "Phase" (icons, shortcuts, standalone)
  favicon.svg, icons/      192/512 icons, maskable icon, apple-touch-icon
scripts/generate-icons.py  Icon generator
vite.config.ts             vite-plugin-pwa (Workbox precache + font runtime cache)
tailwind.config.js         Palette: rose, blush, peach, cream, sage, lilac; animations
src/
  types.ts                 Demographics, CycleBasics, Symptoms, Lifestyle, DailyLog, Prediction…
  lib/
    predictionEngine.ts    Rolling current/next-month forecast, confidence, cycle status
    suggestions.ts         Daily actions: water goal, sleep/rest hours, movement, food, relief, mind, care
    analytics.ts           Cycle history, stats, symptoms by phase, data insights, cycle-health findings
    symptomGuide.ts        "Understand your symptoms" knowledge base (why / what helps / when to get help)
    demoData.ts            Sample cycles for development and tests
    dayMetrics.ts          Fatigue/Sleep/Water/Stress scoring + widget snapshot
    widgetBridge.ts        Sends the snapshot to the native widget (no-op on the web)
    notifications.ts       Plans the 24 motivational/comforting notifications (limits, quiet hours, discreet mode)
    notifier.ts            Delivers them: native local notifications, or the browser Notification API
    nlParser.ts            Natural-language → structured log
    insightEngine.ts       Daily insight + personal pattern detection
    store.ts               App state, actions, accounts and the sync engine
    cloud.ts               Client for the sync server
    webpush.ts             Web Push: subscribe, encrypt notifications on the device, upload the schedule
    merge.ts               Merges edits from two devices
    storage.ts             IndexedDB layer: accounts, encrypted local copies, remembered session
    security.ts            AES-GCM encryption, password → encryption key + auth key, PIN lock
    pwa.ts                 SW registration, update prompt, install prompt
    dates.ts               Timezone-safe calendar-date helpers
  hooks/                   useCycle (derived predictions/insight), useToday, useDaySwipe
  components/
    OnboardingWizard.tsx   Welcome → age → goal → cycle baseline → last period → forecast
    PeriodLogger.tsx       15-second logger: cramps, flow, headache, mood
    DailyDetails.tsx       Bio-markers & lifestyle (discharge, acne, BBT, fatigue, sleep, water, stress, workout, meds, contraception)
    AuthScreen.tsx         Username + password sign in / create account
    Dashboard.tsx          Today tab: day switcher, day at a glance, cycle ring, insight, suggestions, predictions, calendar
    DateNav.tsx            ‹ Today › day switcher (also swipe left/right)
    MetricRings.tsx        Fatigue/Sleep/Water/Stress rings + home-screen widget design
    SuggestionsCard.tsx    Prioritized daily suggestions
    SymptomCheck.tsx       Symptoms tab: select all that apply → Apply → explanations
    InsightsScreen.tsx     Insights tab: Understand your cycle + Trends & charts
    charts.tsx             Dependency-free SVG line/bar/heat-grid charts with tooltips and table view
    BottomNav.tsx          Today · Symptoms · Insights
    CycleCalendar.tsx      Two-month interactive calendar
    NaturalLogBar.tsx      Type or speak to log, live "understood" chips, undo
    LockScreen.tsx, SettingsSheet.tsx, InstallBanner.tsx, ui.tsx
  test/                    Vitest suites
native/                    iOS WidgetKit + Android App Widget code for the home-screen widget
docs/WIDGETS.md            Widget design and step-by-step setup
docs/NOTIFICATIONS.md      Every notification, when it's sent, and its discreet wording
docs/DEPLOY.md             Step by step: GitHub → Cloudflare (free) → Vercel → users' home screens
docs/SERVER.md             Sync server reference: privacy model, invite codes, API
server/                    Server (Hono): app.ts, push.ts, schema.ts, Cloudflare + Node entry points, admin tool
wrangler.toml              Cloudflare Worker + D1 + every-minute cron
vercel.json                Forwards /api/* from Vercel to the Worker
public/push-sw.js          Service-worker code that shows push notifications
capacitor.config.ts        Native app wrapper config (needed for widgets)
```

## How the prediction engine works

1. Logged period days are grouped into periods (a one-day gap is bridged).
2. Cycle lengths between consecutive starts are kept if 15–60 days; with 4+ cycles, outliers beyond ~3 MAD from the median are dropped.
3. The average is a **recency-weighted mean shrunk toward the user's baseline** (baseline counts as 1.5 cycles of evidence). With no history the baseline is used; after 3–4 cycles personal data dominates.
4. Variability starts from an **age-based prior** (wider under 21 and from 40, reflecting post-menarche and perimenopausal irregularity) and is pooled with observed spread.
5. From the last start, cycles are projected through the end of next month. Ovulation ≈ 14 days before each period; fertile window = ovulation −5 to +1. Uncertainty grows with √(cycles ahead).
6. If a period is overdue, it is flagged late and expected from today.
7. Confidence: **high** (≥3 cycles, SD ≤ 2.2 days), **medium** (≥2 cycles, SD ≤ 4), else **low**, with a plain-English reason.

Everything is a pure function of the data, recomputed on every change, so forecasts re-index instantly.

## Intro tour

People who create an account see a short, swipeable tour of the main features: logging, predictions, day at a glance, symptoms and insights, notifications and privacy. They can **Skip** it from the top right, and it's shown only once per account. Settings → *Show the app tour again* replays it.

## Home tab: day switcher and day at a glance

The top of the Today tab has a **‹ Today ›** switcher. Tap the arrows (or swipe left/right) to move between days, or tap the date to pick one. Tapping a day in the calendar jumps to it too. Past days show that day's Fatigue, Sleep, Water and Stress rings, the cycle day as it was, and everything logged, and you can still add or edit entries.

## Home-screen widget

A WHOOP-style widget with Fatigue, Sleep, Water and Stress rings, in small (2×2) and medium (4×2) sizes. Web apps can't place widgets on the home screen, so the widget ships with the iOS and Android app builds (Capacitor). See **docs/WIDGETS.md** for the design and setup steps.

## Notifications

WHOOP-style check-ins during the day: morning sleep check-ins, cycle heads-ups, comfort after a tough log, celebrations and gentle reminders. All 24 are listed in **docs/NOTIFICATIONS.md**. They're off until the user turns them on in Settings. Then: discreet lock-screen wording by default, at most 2 a day plus 1 reminder, quiet hours 9 pm–8 am, and per-category switches.

They're planned on the phone. In the **home-screen web app with a synced account**, they arrive **even when Phase is closed**, via Web Push. Each notification is encrypted on the phone for that phone, so the server only knows when to deliver it, never what it says. In a plain browser tab they show as an in-app banner while Phase is open. The iOS/Android app builds schedule them natively. **Hourly water reminders** (on by default, every hour outside quiet hours) pair with the **Water card** on Today: tap **+ Glass** to log, see progress toward the day's goal, and when the next reminder is due. Each evening, just before quiet hours, **Today's win** celebrates the one thing that went best that day (water goal, a workout, good sleep, a streak and more). **Settings → Notifications → Check notifications** shows, step by step, whether everything needed is in place and what to fix if not.

## Accounts & sync

With the server deployed (see **docs/DEPLOY.md**), people sign in on **any device** with their username and password:

- **End-to-end encrypted.** The password becomes an encryption key (stays on the device) and an auth key (sent to prove the password). The server stores only encrypted blobs it can't read.
- **Invite-only.** Sign-up needs an invite code (`SIGNUP_CODE`), and there's a cap on the number of accounts (`MAX_USERS`, default 25).
- **Works offline.** Each device keeps an encrypted copy. Edits made on two devices are merged (for each day, the newest log wins). The PIN lock and notification settings stay per device.
- **No password reset.** It's impossible by design, because only the password can decrypt the data. Backups can be exported in Settings.

Without a server (plain static hosting), the app falls back to **this-device-only accounts**, exactly as before, and those can be moved to the server later with Settings → *Turn on sync*.

## Suggestions, symptoms and cycle health

- **Suggestions** turn phase + recent logs into concrete targets (“Drink 5 more glasses of water today”, “Aim for 8½ hours of sleep tonight”, “Take a 20-minute rest this afternoon”), plus phase food tips, symptom relief, stress support and a link to any finding worth discussing.
- **Understand your symptoms**: select moods, body symptoms, discharge type or “Everything is fine”, tap Apply. It saves to today's log and explains each item for the current phase, with what helps and when to see a clinician.
- **Understand your cycle** compares your data with typical ranges (cycle 21–35 days, or 21–45 under 18; variation ≤ 7 days, wider for teens and 45+; bleeding 2–7 days) and flags repeated short/long or irregular cycles, long or heavy periods, spotting between periods, recurring severe cramps or migraines, premenstrual mood patterns, no BBT rise, and late/missed periods. Each finding is labeled *Looks typical*, *Good to know*, *Keep an eye on* or *Worth discussing with a doctor*. It never diagnoses.
- **Trends & charts**: cycle length (typical band, average, trend line), period length, symptoms by phase, mood, sleep (with per-phase averages), water and BBT, plus plain-language data insights. Every chart has a table view.

## About the "AI" features

Insights and natural-language logging run **entirely on-device** with deterministic rules (a symptom lexicon with clause-scoped intensity and negation; phase-aware explanations; pattern mining across past cycles). Nothing is sent to an AI service, which keeps the privacy promise. If you later want an LLM, swap `parseNaturalLog`/`generateInsight` for a call to your backend — but that changes the privacy model and needs explicit user consent.

## Privacy & security notes

- Each device keeps an encrypted copy in IndexedDB; `navigator.storage.persist()` is requested to reduce eviction risk. Synced accounts can always be restored by signing in; this-device-only accounts rely on exported backups.
- Data is **encrypted on the device** with the account password, both locally and on the sync server (see Accounts & sync).
- The home-screen widget only receives the four day metrics (and the cycle day only if the user turns it on); full logs never leave the encrypted vault.
- The PIN lock is a quick privacy screen on top of a remembered session.
- Exports exclude lock secrets.

## Platform notes

- **Android Chrome:** native install prompt via the in-app banner; voice logging supported.
- **iOS Safari:** no install prompt API — the banner shows Share → Add to Home Screen. Voice input availability varies by iOS version; the mic button hides when unsupported.

## Medical disclaimer

Phase provides estimates for awareness and planning. It is not a contraceptive method and does not replace medical advice.
