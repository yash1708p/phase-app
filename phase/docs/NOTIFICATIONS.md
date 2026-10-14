# Phase notifications

Gentle, motivational and comforting notifications during the day, built from the user's own logs. They're planned **on the phone**. When they're delivered through the server, they're encrypted on the phone first, so the server never sees what they say.

The planner is in `src/lib/notifications.ts`, and delivery is in `src/lib/notifier.ts`. Users manage them in **Settings → Notifications**, which also lists what's coming up next.

## Rules

- **Off until the user turns them on.** Turning them on asks the phone or browser for permission.
- **Discreet mode is on by default.** Anything that reveals cycle details uses neutral lock-screen wording (shown in the *Discreet* column below).
- **At most 2 a day, plus 1 reminder.** When more would qualify, the most important ones are kept (comfort first, then cycle news, morning check-ins, and celebrations).
- **Quiet hours (default 9 pm–8 am):** nothing is sent. Comfort and celebrations that would land in quiet hours are dropped; cycle news waits until quiet hours end.
- **Each category can be switched off.**
- **Each notification is sent once.** Every notification has a stable key, and the app remembers which keys were sent (in the encrypted account data).
- **Serious findings stay in the app.** A notification never mentions possible pregnancy, missed periods or medical concerns. It only says something is worth a look.
- **The user's name** is used when the username looks like a first name ("maya" → "Maya").

## The 24 notifications

| # | When | Title / body | Discreet version |
|---|---|---|---|
| **Morning check-ins** | | | |
| 1 | Sleep logged before 2 pm, more than 1 hour under goal | *A shorter night 😴* — You logged 5½ hours of sleep, Maya. Go easy today and aim for 8½ hours tonight. | — |
| 2 | Sleep logged, at or near goal | *Well rested ✨* — 8 hours of sleep last night, a great start to your day. | — |
| 3 | Last three nights all short | *Catching up on sleep* — Your last three nights were short. An earlier bedtime tonight will help you get back on track. | — |
| **Cycle moments** | | | |
| 4 | 9 am, two days before the predicted period | *Heads-up for later this week* — Your period is expected around Thursday. Might be worth packing supplies. | *Phase* — You have a cycle update for this week. |
| 5 | 9 am on the predicted day | *Today's the day, probably* — Your period is due today. Log it when it starts so Phase can keep learning. | *A quick check-in from Phase* — Open Phase for today's cycle update. |
| 6 | Day 1 is logged | *Be gentle with yourself today 🌸* — Day 1 is often the toughest. Heat, rest and water can help, Maya. | Same title — Heat, rest and water can help, Maya. |
| 7 | 9 am, two days after the last bleeding day | *Period done ✨* — Your period lasted 5 days. Energy usually starts lifting from here. | *A new phase starts ✨* — Open Phase to see what to expect this week. |
| 8 | 3+ days late (once per cycle) | *Your cycle's running a little late* — Stress, travel and sleep can all shift things. Log it when it starts and Phase will adjust. | *Phase* — You have a cycle update. Open Phase to see it. |
| 9 | 9:30 am, four days after the period ends | *Energy on the rise ⚡* — Estrogen is climbing. It's a great window for a harder workout or trying something new. | Same title — It's a great window for a harder workout or trying something new. |
| 10 | 9:30 am, six days before the predicted period | *Pre-period days ahead* — Bloating, cravings or a shorter fuse are common this week. Extra sleep and magnesium-rich foods can help. | *Look after yourself this week* — Extra sleep and magnesium-rich foods can help you feel your best. |
| 11 | 9 am, first fertile day (goal: trying to conceive only) | *Your fertile window starts today* — Your most fertile days are here. The days just before ovulation matter most. | *Phase* — You have a cycle update. Open Phase to see it. |
| **Comfort on tough days** (about a minute after logging) | | | |
| 12 | Severe cramps | *Sorry today's rough 💛* — A heat pad and 20 minutes of rest can ease severe cramps. | *Sending you some care 💛* — Be gentle with yourself today. Rest and warmth can help. |
| 13 | High stress | *A heavy day, Maya* — Five slow breaths or a short walk can take the edge off. | — |
| 14 | Low mood | *Sending you some kindness 💛* — Low days happen. A little daylight and a message to someone you like can help. | — |
| 15 | Migraine | *Rest somewhere dark and quiet* — Water, dimmed screens and a short rest are a good first step. | — |
| 16 | 7 pm, when a symptom recurred on tomorrow's cycle day in most recent cycles | *Heads-up for tomorrow* — In your last 3 cycles, cramps showed up around cycle day 1. Keep a heat pad handy. | Same title — Phase spotted a pattern for tomorrow. Open the app to see it. |
| **Motivation and celebrations** | | | |
| 17 | Water goal reached | *Hydration goal reached 💧* — 9 glasses today. Nicely done, Maya! | — |
| 18 | 3 pm, under half the water goal (only for people who log water) | *Time for a water break 💧* — You're at 3 of 9 glasses. A glass now helps keep headaches away. | — |
| 19 | A workout logged on a period day | *Impressive effort 💪* — You logged a workout on a period day. Remember to rest up tonight. | Same title — Great job moving today. Remember to rest up tonight. |
| 20 | 7- and 30-day logging streaks | *7 days in a row 🔥* — Every log makes your insights more personal. | — |
| 21 | Predictions reach high confidence (once) | *Your predictions just got sharper 🎯* — 3 regular cycles logged. Phase now has high confidence in your forecast. | — |
| **Gentle reminders** (max 1 a day) | | | |
| 22 | 8 pm, nothing logged that day | *How was today?* — Take 15 seconds to log how you feel. | — |
| 23 | 8 am, for people who logged BBT in the last week | *Temperature check 🌡️* — Take it before you get up for the most accurate reading. | — |
| 24 | A new "worth discussing with a doctor" finding (once each) | *Something in your cycle is worth a look* — Open Insights to see what Phase noticed. | — |

The plan is recalculated whenever the user logs something, when the app is reopened, and every few minutes while it's open. That keeps scheduled notifications accurate: for example, logging water before 3 pm cancels or updates the water nudge.

## Delivery

| Where Phase runs | How notifications are delivered | Arrive when Phase is closed? |
|---|---|---|
| Home-screen web app (iPhone 16.4+, Android) or a desktop browser, **signed in to a synced account** | **Web Push** through the Phase server (`src/lib/webpush.ts`, `server/push.ts`) | **Yes** |
| iPhone / Android app build (Capacitor) | `@capacitor/local-notifications`, scheduled on the device | **Yes** |
| Browser without push (a normal Safari tab, an account on this device only, or no server) | Timers while Phase is open | No: they show as a banner while Phase is open, and missed ones appear when it's reopened |

**How push stays private:**

1. The phone plans its notifications (rules above), then **encrypts each one for itself** with the browser's push keys (RFC 8291). Only that phone can read it.
2. It uploads the encrypted notifications and their send times. The server stores only those blobs.
3. A Cloudflare cron trigger checks every minute and hands due ones to Apple's, Google's or Mozilla's push service, which wakes the phone. The service worker (`public/push-sw.js`) shows the notification.
4. Whenever the user logs something, the plan is recalculated and re-uploaded, replacing the old one. Logging water before 3 pm still cancels the water nudge.

Each device that turns notifications on gets its own schedule. Logging out removes the device from the server.

**Send a test notification** goes through the whole chain (phone → server → push service → phone). If it arrives with the screen locked, everything works.

### App setup

The plugin is already in `package.json`, so `npm run cap:sync` installs it into the iOS and Android projects.

- **Android:** copy `native/android/app/src/main/res/drawable/ic_stat_phase.xml` along with the widget resources (see WIDGETS.md). It's the status-bar icon, set in `capacitor.config.ts`. The plugin adds the notification permission itself. Phase schedules *inexact* alarms on purpose, so users are never sent to the "Alarms & reminders" settings screen.
- **iOS:** nothing extra. Permission is requested when the user turns notifications on in Settings. In Discreet mode, combine with the iPhone's *Settings → Notifications → Show Previews* for even more privacy.
