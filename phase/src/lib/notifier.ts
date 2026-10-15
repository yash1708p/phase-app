/**
 * Notification delivery.
 *
 * - iOS / Android app builds: real local notifications via
 *   @capacitor/local-notifications. They're scheduled on the phone and arrive
 *   even when Phase is closed.
 * - Home-screen web app with a synced account: Web Push through the Phase
 *   server, so they arrive while Phase is closed.
 * - Otherwise (browser tab, this-device-only account, no server): shown only
 *   while Phase is open.
 */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { PlannedNotification } from './notifications';
import { ensurePushSubscription, getServerPushStatus, pushSupported, renewPushSubscription, resetPushCache, sendTestPush, uploadSchedule, type PushSendResult } from './webpush';
import { cloudToken, getSyncStatus } from './store';

export type NotifyPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

const isNative = () => Capacitor.isNativePlatform();
const hasWebNotifications = () => typeof window !== 'undefined' && 'Notification' in window;

export const notificationsSupported = () => isNative() || hasWebNotifications();
/**
 * How notifications reach this device:
 *  - native: the iOS/Android app schedules them on the phone;
 *  - push:   the home-screen web app, via the Phase server (arrive even when closed);
 *  - web:    the browser, only while Phase is open (no server, or push unavailable).
 */
export type DeliveryMode = 'native' | 'push' | 'web';
let mode: DeliveryMode = isNative() ? 'native' : 'web';
export const deliveryMode = () => mode;

/** Whether notifications can arrive while the app is closed. */
export const deliversWhenClosed = () => mode !== 'web';

let pushState: { token: string; sub: PushSubscription } | null = null;

/** Set up push for this device if possible (needs a synced account and notification permission). */
async function activePush(): Promise<{ token: string; sub: PushSubscription } | null> {
  if (isNative() || !pushSupported() || Notification.permission !== 'granted') return null;
  const token = await cloudToken();
  if (!token) return null;
  if (pushState?.token === token) return pushState;
  const sub = await ensurePushSubscription(token);
  pushState = sub ? { token, sub } : null;
  return pushState;
}

/** Call right after the user allows notifications (some browsers want this during the tap). */
export async function enablePush(): Promise<boolean> {
  try {
    pushState = null;
    return !!(await activePush());
  } catch {
    return false;
  }
}

/** Stable 31-bit numeric id from the string key (native APIs need numbers). */
export function numericId(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) & 0x7fffffff;
}

export async function getPermission(): Promise<NotifyPermission> {
  try {
    if (isNative()) {
      const { display } = await LocalNotifications.checkPermissions();
      return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'prompt';
    }
    if (!hasWebNotifications()) return 'unsupported';
    return Notification.permission === 'default' ? 'prompt' : Notification.permission;
  } catch {
    return 'unsupported';
  }
}

export async function requestPermission(): Promise<NotifyPermission> {
  try {
    if (isNative()) {
      const { display } = await LocalNotifications.requestPermissions();
      return display === 'granted' ? 'granted' : 'denied';
    }
    if (!hasWebNotifications()) return 'unsupported';
    const result = await Notification.requestPermission();
    return result === 'default' ? 'prompt' : result;
  } catch {
    return 'unsupported';
  }
}

/* ------------------------------------------------------------------ */
/* Web: show while the app is open                                      */
/* ------------------------------------------------------------------ */

/**
 * Browsers (and home-screen web apps on iPhone and Android) only run Phase's
 * timers while it's open; phones pause them as soon as Phase is in the
 * background. So on the web:
 *  - a notification is only recorded as sent once it has actually been shown;
 *  - anything that came due while Phase was closed is shown when it reopens
 *    (the planner keeps same-day items like the period heads-up for this);
 *  - while Phase is on screen, it appears as a banner inside the app (phones
 *    don't reliably show a web app's own notifications while it's open).
 */

export interface InAppMessage {
  key: string;
  title: string;
  body: string;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inAppListeners = new Set<(m: InAppMessage) => void>();
let onShownCallback: ((key: string, at: number) => void) | null = null;

/** Subscribe to notifications shown as in-app banners. */
export function onInAppMessage(fn: (m: InAppMessage) => void) {
  inAppListeners.add(fn);
  return () => {
    inAppListeners.delete(fn);
  };
}

/** Called with each notification that was actually shown (web only), so it's never sent twice. */
export function setOnShown(fn: ((key: string, at: number) => void) | null) {
  onShownCallback = fn;
}

async function showSystem(title: string, body: string, tag: string): Promise<boolean> {
  if (!hasWebNotifications() || Notification.permission !== 'granted') return false;
  const options: NotificationOptions = { body, tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    new Notification(title, options);
    return true;
  } catch {
    return false; // some mobile browsers only allow service-worker notifications
  }
}

const appVisible = () => typeof document !== 'undefined' && document.visibilityState === 'visible';

async function deliverWeb(n: { key: string; title: string; body: string }) {
  if (appVisible() && inAppListeners.size) {
    inAppListeners.forEach((l) => l(n));
  } else if (!(await showSystem(n.title, n.body, n.key))) {
    return; // couldn't show it anywhere — keep it for next time
  }
  onShownCallback?.(n.key, Date.now());
}

/** First time each notification was planned for, so re-planning never pushes it later. */
const targets = new Map<string, number>();

function syncWeb(plan: PlannedNotification[]) {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  const now = Date.now();
  const keys = new Set(plan.map((n) => n.key));
  for (const k of [...targets.keys()]) if (!keys.has(k)) targets.delete(k);
  for (const n of plan) {
    const at = Math.min(n.at, targets.get(n.key) ?? Infinity);
    targets.set(n.key, at);
    const delay = at - now;
    if (delay > 24 * 3_600_000) continue; // timers only make sense while the app stays open
    timers.set(
      n.key,
      setTimeout(() => {
        timers.delete(n.key);
        targets.delete(n.key);
        void deliverWeb(n);
      }, Math.max(0, delay)),
    );
  }
}

/* ------------------------------------------------------------------ */
/* Native: schedule on the device                                       */
/* ------------------------------------------------------------------ */

let lastNativeSignature = '';

async function syncNative(plan: PlannedNotification[]) {
  const signature = plan.map((n) => `${n.key}@${n.at}:${n.title}|${n.body}`).join('\n');
  if (signature === lastNativeSignature) return;
  lastNativeSignature = signature;

  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) {
    await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  }
  const now = Date.now();
  const future = plan.filter((n) => n.at > now - 30_000);
  if (!future.length) return;
  await LocalNotifications.schedule({
    notifications: future.map((n) => ({
      id: numericId(n.key),
      title: n.title,
      body: n.body,
      schedule: { at: new Date(Math.max(n.at, now + 5_000)), allowWhileIdle: true },
      // Exact timing isn't needed, and asking for it would send Android users to a system settings screen.
      isExactNotification: false,
      extra: { key: n.key },
    })),
  });
}

/** Replace everything scheduled with this plan. Pass [] to cancel all (e.g. when turned off). */
let lastPlan: PlannedNotification[] = [];
/** Why the last attempt to use push failed (shown in the notification check). */
let lastPushError: string | null = null;

export async function syncNotifications(plan: PlannedNotification[]): Promise<DeliveryMode> {
  lastPlan = plan;
  try {
    if (isNative()) {
      await syncNative(plan);
      return (mode = 'native');
    }
    const push = await activePush().catch((e: unknown) => {
      lastPushError = e instanceof Error ? e.message : String(e);
      return null;
    });
    if (push) {
      await uploadSchedule(push.token, push.sub, plan);
      lastPushError = null;
      syncWeb([]); // the server delivers them now — no in-page timers needed
      return (mode = 'push');
    }
    syncWeb(plan);
  } catch (err) {
    console.warn('[Phase] Could not schedule notifications', err);
    lastPushError = err instanceof Error ? err.message : String(err);
    pushState = null;
    syncWeb(plan); // fall back to showing them while the app is open
  }
  return (mode = 'web');
}

/* ------------------------------------------------------------------ */
/* Test + check-up                                                      */
/* ------------------------------------------------------------------ */

export interface TestResult {
  ok: boolean;
  /** How the test was delivered. */
  via: DeliveryMode;
  /** What the person should know (success hint or what went wrong). */
  message: string;
}

const isIOS = () =>
  typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** Plain-language explanation of a push service's answer. */
export function explainPushStatus(status: number, reason?: string | null): string {
  const r = reason ? ` (${reason})` : '';
  if (status >= 200 && status < 300) return 'Delivered to Apple/Google, who pass it to the phone.';
  if (status === 0) return `The server couldn’t reach Apple/Google${r}. It will try again.`;
  if (status === 404 || status === 410) return 'This phone’s notification address has expired. Run the check again to renew it.';
  if (status === 403 || status === 401) return `Apple/Google refused the server’s signature${r}.`;
  if (status === 400) return `Apple/Google rejected the message${r}.`;
  if (status === 413) return 'The notification was too large.';
  if (status === 429) return 'Too many notifications at once. It will try again.';
  return `Apple/Google answered with code ${status}${r}.`;
}

/** Push for the test: renews this phone's push address once if it expired. */
async function sendPushTest(title: string, body: string): Promise<PushSendResult | null> {
  let push = await activePush();
  if (!push) return null;
  let result = await sendTestPush(push.token, push.sub, title, body);
  if (result.expired) {
    const sub = await renewPushSubscription(push.token);
    pushState = sub ? { token: push.token, sub } : null;
    push = pushState;
    if (!push) return result;
    result = await sendTestPush(push.token, push.sub, title, body);
    if (lastPlan.length) await uploadSchedule(push.token, push.sub, lastPlan);
  }
  return result;
}

export async function sendTestNotification(): Promise<TestResult> {
  const title = 'Phase notifications are on 💛';
  const body = 'You’ll get gentle check-ins like this during the day.';
  try {
    if (isNative()) {
      await LocalNotifications.schedule({
        notifications: [{ id: numericId('test'), title, body, schedule: { at: new Date(Date.now() + 3_000) }, isExactNotification: false }],
      });
      return { ok: true, via: 'native', message: 'Sent. It should appear in a few seconds.' };
    }
    // Home-screen web app with push: send it through the server, exactly like real ones.
    let pushError: string | null = null;
    const result = await sendPushTest(title, 'This one came through the server, so notifications will arrive even when Phase is closed.').catch((e: unknown) => {
      pushError = e instanceof Error ? e.message : 'Couldn’t reach the Phase server.';
      return null;
    });
    if (result) {
      return result.ok
        ? {
            ok: true,
            via: 'push',
            message:
              'Sent through the server. It should arrive within a few seconds, even if you close Phase now. If it doesn’t, check that Focus / Do Not Disturb is off and that notifications for Phase are allowed in your phone’s settings.',
          }
        : { ok: false, via: 'push', message: explainPushStatus(result.status ?? 0, result.reason) };
    }
    // Otherwise: show it inside the app and ask the system to show it too.
    inAppListeners.forEach((l) => l({ key: 'test', title, body }));
    const system = await showSystem(title, body, 'test');
    const why = pushError ?? (await whyNoPush());
    return {
      ok: system || inAppListeners.size > 0,
      via: 'web',
      message: `This one was shown by the app itself, so it only works while Phase is open. ${why}`,
    };
  } catch (e) {
    return { ok: false, via: mode, message: e instanceof Error ? e.message : 'Couldn’t send a test notification.' };
  }
}

/** One-line reason why this device can't get notifications while Phase is closed. */
async function whyNoPush(): Promise<string> {
  const failing = (await checkNotifications()).find((s) => s.state === 'fail');
  return failing ? `${failing.title}: ${failing.detail}` : 'Run “Check notifications” to see why.';
}

export interface CheckStep {
  title: string;
  state: 'ok' | 'fail' | 'warn';
  detail: string;
}

const timeLabel = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Walk through everything notifications need on this device, in order, and
 * say exactly what's missing. Also re-registers this device and re-uploads its
 * schedule, which fixes most problems on its own.
 */
export async function checkNotifications(): Promise<CheckStep[]> {
  const steps: CheckStep[] = [];
  const stop = () => steps;

  if (isNative()) {
    const p = await getPermission();
    steps.push(
      p === 'granted'
        ? { title: 'Notifications allowed', state: 'ok', detail: 'They’re scheduled on this phone and arrive even when Phase is closed.' }
        : { title: 'Notifications allowed', state: 'fail', detail: 'Allow notifications for Phase in your phone’s settings.' },
    );
    return steps;
  }

  // 1. Permission
  const permission = await getPermission();
  if (permission !== 'granted') {
    steps.push({
      title: 'Notifications allowed',
      state: 'fail',
      detail:
        permission === 'denied'
          ? isIOS()
            ? 'They’re blocked. Open your iPhone’s Settings → Notifications → Phase and turn on Allow Notifications.'
            : 'They’re blocked. Allow notifications for this site in your browser or phone settings.'
          : 'Turn notifications on above.',
    });
    return stop();
  }
  steps.push({ title: 'Notifications allowed', state: 'ok', detail: 'This device lets Phase show notifications.' });

  // 2. Home screen (required on iPhone)
  if (isIOS() && !isStandalone()) {
    steps.push({
      title: 'Opened from the home screen',
      state: 'fail',
      detail: 'On iPhone, notifications only work in Phase added to the home screen. In Safari tap Share → Add to Home Screen, open Phase from that icon, sign in and turn notifications on there.',
    });
    return stop();
  }
  steps.push({
    title: 'Opened from the home screen',
    state: isStandalone() ? 'ok' : 'warn',
    detail: isStandalone() ? 'Phase is running as a home-screen app.' : 'Phase is open in a browser tab. Adding it to your home screen works best.',
  });

  // 3. Push support
  if (!pushSupported()) {
    steps.push({
      title: 'Notifications while closed',
      state: 'fail',
      detail: isIOS() ? 'This iPhone can’t receive them. Update to iOS 16.4 or later.' : 'This browser can’t receive notifications while Phase is closed. Try Chrome, Edge, Firefox or Safari.',
    });
    return stop();
  }

  // 4. Synced account
  const sync = getSyncStatus();
  if (sync.state === 'local') {
    steps.push({
      title: 'Account synced with the server',
      state: 'fail',
      detail: 'Your account is stored on this device only, so the server can’t send it notifications. Scroll to Account below and tap Turn on sync, then run this check again.',
    });
    return stop();
  }
  const token = await cloudToken();
  if (!token) {
    steps.push({
      title: 'Account synced with the server',
      state: 'fail',
      detail: sync.state === 'signin' ? 'Phase needs your password again. Use Account below to sign in, then run this check again.' : 'Can’t reach the Phase server right now. Check your internet connection.',
    });
    return stop();
  }
  steps.push({ title: 'Account synced with the server', state: 'ok', detail: 'Signed in to the Phase server.' });

  // 5. Register this device and upload its schedule again
  pushState = null;
  resetPushCache();
  let push: { token: string; sub: PushSubscription } | null;
  try {
    push = await activePush();
    if (!push) throw new Error('This device couldn’t get a notification address. Close Phase completely, reopen it and try again.');
    await uploadSchedule(push.token, push.sub, lastPlan);
    mode = 'push';
    lastPushError = null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const browserRefused = /permission|denied|abort|not allowed|registration/i.test(msg);
    steps.push({
      title: 'This device registered',
      state: 'fail',
      detail: browserRefused
        ? `Your phone or browser wouldn’t create a notification address for Phase (“${msg}”). Turn notifications off and on again above${isIOS() ? ', making sure Phase was opened from its home-screen icon' : ''}, then run this check again.`
        : msg,
    });
    return stop();
  }
  steps.push({ title: 'This device registered', state: 'ok', detail: 'The server knows where to send this phone’s notifications.' });

  // 6. What the server has
  let status: Awaited<ReturnType<typeof getServerPushStatus>>;
  try {
    status = await getServerPushStatus(push.token, push.sub);
  } catch (e) {
    steps.push({
      title: 'Server up to date',
      state: 'fail',
      detail: `${e instanceof Error ? e.message : 'The server didn’t answer.'} If this keeps happening, the server may be running an older version: redeploy it in Cloudflare.`,
    });
    return stop();
  }
  steps.push({
    title: 'Notifications waiting on the server',
    state: status.queued > 0 || lastPlan.length === 0 ? 'ok' : 'warn',
    detail:
      status.queued > 0
        ? `${status.queued} waiting. Next one: ${timeLabel(status.next!)}.`
        : lastPlan.length === 0
          ? 'None planned right now. New ones are added as you log and as your cycle moves along.'
          : 'None are waiting even though some are planned. Run the check again.',
  });

  // 7. The every-minute timer
  const age = status.lastRun ? status.now - status.lastRun : null;
  steps.push(
    age !== null && age < 5 * 60_000
      ? { title: 'Server sending every minute', state: 'ok', detail: `Last run ${Math.max(0, Math.round(age / 1000))} seconds ago.` }
      : {
          title: 'Server sending every minute',
          state: 'fail',
          detail:
            age === null
              ? 'The server’s every-minute timer has never run, so scheduled notifications are never sent. In Cloudflare open Workers & Pages → phase-api → Settings → Trigger events, and check there’s a Cron trigger “* * * * *” (add it if it’s missing).'
              : `The every-minute timer last ran ${timeLabel(status.lastRun!)}. In Cloudflare open Workers & Pages → phase-api → Settings → Trigger events, and check the Cron trigger “* * * * *” is there.`,
        },
  );

  // 8. The last delivery
  if (status.last) {
    const ok = status.last.status >= 200 && status.last.status < 300;
    steps.push({
      title: 'Last delivery',
      state: ok ? 'ok' : 'fail',
      detail: `${timeLabel(status.last.at)}: ${explainPushStatus(status.last.status, status.last.reason)}`,
    });
  }
  return steps;
}

/** Why notifications currently can't arrive while Phase is closed (null if they can). */
export const pushProblem = () => lastPushError;
