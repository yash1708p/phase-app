/**
 * Merging two copies of one account's data (e.g. phone and laptop both
 * changed things while one was offline).
 *
 * - Daily logs: per day, the most recently edited version wins.
 * - Period days follow the winning log for that day; days without a log are kept from both.
 * - Profile and shared settings: from whichever copy changed most recently.
 * - Device-only settings (PIN lock, biometrics, notifications, install banner)
 *   always stay as they are on this device.
 */
import type { AppData, Settings } from '../types';

const DEVICE_ONLY: (keyof Settings)[] = ['lockEnabled', 'pinHash', 'pinSalt', 'biometricCredentialId', 'installBannerDismissedAt', 'notifications'];

function deviceSettings(s: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const k of DEVICE_ONLY) if (s[k] !== undefined) (out as Record<string, unknown>)[k] = s[k];
  return out;
}

/** Settings with this device's device-only values, so they're never overwritten (and never uploaded meaningfully). */
export function withDeviceSettings(shared: Settings, device: Settings): Settings {
  const clean = { ...shared } as Record<string, unknown>;
  for (const k of DEVICE_ONLY) delete clean[k];
  return { ...(clean as unknown as Settings), lockEnabled: false, ...deviceSettings(device) };
}

export function mergeData(local: AppData, remote: AppData): AppData {
  const newer = (remote.updatedAt ?? 0) > (local.updatedAt ?? 0) ? remote : local;

  const logs = { ...remote.logs };
  for (const [date, log] of Object.entries(local.logs)) {
    const other = logs[date];
    if (!other || (log.updatedAt ?? 0) >= (other.updatedAt ?? 0)) logs[date] = log;
  }

  const days = new Set<string>();
  for (const d of [...local.periodDays, ...remote.periodDays]) days.add(d);
  for (const [date, log] of Object.entries(logs)) {
    if (log.cycle.isPeriodDay) days.add(date);
    else days.delete(date);
  }

  return {
    ...newer,
    username: local.username ?? remote.username,
    profile: newer.profile ?? local.profile ?? remote.profile,
    logs,
    periodDays: [...days].sort(),
    settings: withDeviceSettings(newer.settings, local.settings),
    notificationLog: local.notificationLog,
    updatedAt: Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0) || undefined,
  };
}

/** Take the server copy as-is, keeping this device's own settings. */
export function adoptRemote(local: AppData, remote: AppData): AppData {
  return { ...remote, username: local.username ?? remote.username, settings: withDeviceSettings(remote.settings, local.settings), notificationLog: local.notificationLog };
}
