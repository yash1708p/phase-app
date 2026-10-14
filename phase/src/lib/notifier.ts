/**
 * Notification delivery.
 *
 * - iOS / Android app builds: real local notifications via
 *   @capacitor/local-notifications. They're scheduled on the phone and arrive
 *   even when Phase is closed.
 * - Browser / PWA: the Notification API. Without a push server, the browser
 *   can only show them while Phase is open (or running in the background),
 *   so on the web they're best-effort.
 */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { PlannedNotification } from './notifications';
import { ensurePushSubscription, pushSupported, sendTestPush, uploadSchedule } from './webpush';
import { cloudToken } from './store';

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
export async function syncNotifications(plan: PlannedNotification[]): Promise<DeliveryMode> {
  try {
    if (isNative()) {
      await syncNative(plan);
      return (mode = 'native');
    }
    const push = await activePush().catch(() => null);
    if (push) {
      await uploadSchedule(push.token, push.sub, plan);
      syncWeb([]); // the server delivers them now — no in-page timers needed
      return (mode = 'push');
    }
    syncWeb(plan);
  } catch (err) {
    console.warn('[Phase] Could not schedule notifications', err);
    pushState = null;
    syncWeb(plan); // fall back to showing them while the app is open
  }
  return (mode = 'web');
}

export async function sendTestNotification(): Promise<boolean> {
  const title = 'Phase notifications are on 💛';
  const body = 'You’ll get gentle check-ins like this during the day.';
  try {
    if (isNative()) {
      await LocalNotifications.schedule({
        notifications: [{ id: numericId('test'), title, body, schedule: { at: new Date(Date.now() + 3_000) }, isExactNotification: false }],
      });
      return true;
    }
    // Home-screen web app with push: send it through the server, exactly like real ones.
    const push = await activePush().catch(() => null);
    if (push && (await sendTestPush(push.token, push.sub, title, 'This one came through the server, so notifications will arrive even when Phase is closed.').catch(() => false))) {
      return true;
    }
    // Otherwise: show it inside the app (always visible) and ask the system to show it too.
    inAppListeners.forEach((l) => l({ key: 'test', title, body }));
    const system = await showSystem(title, body, 'test');
    return system || inAppListeners.size > 0;
  } catch {
    return false;
  }
}
