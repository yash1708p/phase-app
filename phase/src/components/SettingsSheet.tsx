import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Droplet, Stethoscope, XCircle, Sparkles, Bell, BellOff, Cloud, CloudOff, RefreshCw, CalendarDays, Download, EyeOff, Moon, KeyRound, Lock, LogOut, ShieldCheck, Trash2, Upload, UserRound } from 'lucide-react';
import type { AppData, PrimaryGoal } from '../types';
import { hashPin } from '../lib/security';
import { exportJSON } from '../lib/storage';
import { AuthError, enableSync, getSyncStatus, reauthenticate, serverInfo, sync, useSyncStatus, updateNotificationSettings, changePassword, deleteAccount, importData, loadDemoData, logout, passwordStrength, updateProfile, updateSettings } from '../lib/store';
import { buildDemoData } from '../lib/demoData';
import { todayISO } from '../lib/dates';
import { PinPad } from './LockScreen';
import { WidgetMedium, WidgetSmall } from './MetricRings';
import type { WidgetSnapshot } from '../lib/dayMetrics';
import { nativePlatform } from '../lib/widgetBridge';
import { CATEGORY_INFO, categoryOn, DEFAULT_NOTIFICATION_SETTINGS, type PlannedNotification } from '../lib/notifications';
import { checkNotifications, deliveryMode, enablePush, getPermission, notificationsSupported, requestPermission, sendTestNotification, type CheckStep, type NotifyPermission, type TestResult } from '../lib/notifier';
import type { NotificationCategory, NotificationSettings } from '../types';
import { Button, Chip, SectionLabel, Sheet, Stepper, cx } from './ui';

const GOALS: { id: PrimaryGoal; label: string }[] = [
  { id: 'track_period', label: 'Track period' },
  { id: 'understand_symptoms', label: 'Symptoms' },
  { id: 'trying_to_conceive', label: 'Conceive' },
  { id: 'general_wellbeing', label: 'Wellbeing' },
];

export default function SettingsSheet({
  open,
  onClose,
  data,
  widgetSnapshot,
  upcoming = [],
}: {
  open: boolean;
  onClose: () => void;
  data: AppData;
  widgetSnapshot?: WidgetSnapshot | null;
  upcoming?: PlannedNotification[];
}) {
  const { profile, settings } = data;
  const [pinStep, setPinStep] = useState<null | 'choose' | 'confirm'>(null);
  const [firstPin, setFirstPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setPinStep(null);
      setMessage(null);
    }
  }, [open]);

  if (!profile) return null;

  const onPin = async (pin: string) => {
    if (pinStep === 'choose') {
      setFirstPin(pin);
      setPinStep('confirm');
      setPinError(null);
      return true;
    }
    if (pin !== firstPin) {
      setPinError('PINs didn’t match — let’s try again.');
      setPinStep('choose');
      return false;
    }
    const { hash, salt } = await hashPin(pin);
    updateSettings({ lockEnabled: true, pinHash: hash, pinSalt: salt });
    setPinStep(null);
    setMessage('App lock is on.');
    return true;
  };

  const doExport = () => {
    const url = URL.createObjectURL(exportJSON(data));
    const a = document.createElement('a');
    a.href = url;
    a.download = `phase-backup-${todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const doImport = async (file: File) => {
    try {
      importData(JSON.parse(await file.text()));
      setMessage('Backup restored.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      {pinStep ? (
        <div className="py-4">
          <PinPad
            key={pinStep}
            title={pinStep === 'choose' ? 'Choose a 4-digit PIN' : 'Confirm your PIN'}
            subtitle="You’ll enter this each time you open Phase."
            error={pinError}
            onComplete={onPin}
          />
          <Button variant="ghost" block className="mt-4" onClick={() => setPinStep(null)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="space-y-6 pb-4">
          {message && (
            <p role="status" className="rounded-xl bg-sage-100 px-3 py-2 text-sm text-sage-600">
              {message}
            </p>
          )}

          <AccountSection username={data.username} onDone={setMessage} onSignedOut={onClose} />

          <section className="space-y-4">
            <h3 className="font-display text-lg text-ink">Your cycle</h3>
            <div>
              <SectionLabel>Age</SectionLabel>
              <Stepper label="age" value={profile.age} min={10} max={60} suffix="years" onChange={(age) => updateProfile({ age })} />
            </div>
            <div>
              <SectionLabel hint="Your logs refine this">Typical cycle</SectionLabel>
              <Stepper label="cycle length" value={profile.typicalCycleLength} min={18} max={50} suffix="days" onChange={(n) => updateProfile({ typicalCycleLength: n })} />
            </div>
            <div>
              <SectionLabel>Typical period</SectionLabel>
              <Stepper label="period length" value={profile.typicalPeriodLength} min={2} max={10} suffix="days" onChange={(n) => updateProfile({ typicalPeriodLength: n })} />
            </div>
            <div>
              <SectionLabel>Goal</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                {GOALS.map((g) => (
                  <Chip key={g.id} selected={profile.primaryGoal === g.id} onClick={() => updateProfile({ primaryGoal: g.id })}>
                    {g.label}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <SectionLabel>Temperature unit</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                {(['C', 'F'] as const).map((u) => (
                  <Chip key={u} selected={settings.tempUnit === u} onClick={() => updateSettings({ tempUnit: u })}>
                    °{u}
                  </Chip>
                ))}
              </div>
            </div>
          </section>

          <NotificationsSection settings={settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS} upcoming={upcoming} />

          <WidgetSection snapshot={widgetSnapshot ?? null} showCycle={!!settings.widgetShowCycle} />

          <section className="space-y-3">
            <h3 className="font-display text-lg text-ink">Privacy</h3>
            <Row
              icon={<Lock size={18} />}
              title="App lock (PIN)"
              body="Ask for a PIN every time Phase opens."
              on={settings.lockEnabled}
              onToggle={() => {
                if (settings.lockEnabled) updateSettings({ lockEnabled: false, pinHash: undefined, pinSalt: undefined });
                else {
                  setPinError(null);
                  setPinStep('choose');
                }
              }}
            />
            <p className="flex gap-2 rounded-xl bg-cream-200 p-3 text-xs text-ink-soft">
              <ShieldCheck size={16} className="shrink-0 text-sage-600" />
              {getSyncStatus().state === 'local'
                ? 'Your data is encrypted with your password and stored only on this device. There’s no cloud copy — clearing site data, uninstalling, or forgetting your password means it can’t be recovered, so export a backup now and then.'
                : 'Your data is encrypted on your device with your password before it’s synced, so the Phase server can’t read it. A forgotten password can’t be reset, so export a backup now and then.'}
            </p>
          </section>

          <Button
            variant="soft"
            block
            onClick={() => {
              updateSettings({ showIntro: true });
              onClose();
            }}
          >
            <Sparkles size={18} /> Show the app tour again
          </Button>

          <section className="space-y-2">
            <h3 className="font-display text-lg text-ink">Your data</h3>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="soft" onClick={doExport}>
                <Download size={18} /> Export
              </Button>
              <Button variant="soft" onClick={() => fileRef.current?.click()}>
                <Upload size={18} /> Import
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doImport(f);
                e.target.value = '';
              }}
            />
            {import.meta.env.DEV && (
              <Button variant="ghost" block onClick={() => loadDemoData(buildDemoData(todayISO()))}>
                Load sample data (dev only)
              </Button>
            )}
            <DeleteAccount onDeleted={onClose} />
          </section>
        </div>
      )}
    </Sheet>
  );
}

function Row({ icon, title, body, on, onToggle }: { icon: ReactNode; title: string; body: string; on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} role="switch" aria-checked={on} className="flex w-full items-center gap-3 rounded-2xl bg-white/80 p-3 text-left ring-1 ring-blush-200">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blush-100 text-rose-600">{icon}</span>
      <span className="flex-1">
        <span className="block font-semibold text-ink">{title}</span>
        <span className="block text-xs text-ink-soft">{body}</span>
      </span>
      <span className={cx('relative h-7 w-12 shrink-0 rounded-full transition', on ? 'bg-rose-500' : 'bg-blush-200')}>
        <span className={cx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-6' : 'left-1')} />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Account                                                              */
/* ------------------------------------------------------------------ */

function AccountSection({ username, onDone, onSignedOut }: { username?: string; onDone: (msg: string) => void; onSignedOut: () => void }) {
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      setChanging(false);
      setCurrent('');
      setNext('');
      onDone('Password changed.');
    } catch (e) {
      setError(e instanceof AuthError ? e.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <h3 className="font-display text-lg text-ink">Account</h3>
      <div className="flex items-center gap-3 rounded-2xl bg-white/80 p-3 ring-1 ring-blush-200">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-blush-100 text-rose-600">
          <UserRound size={18} />
        </span>
        <div className="flex-1">
          <p className="text-xs text-ink-faint">Signed in as</p>
          <p className="font-semibold text-ink">{username ?? '—'}</p>
        </div>
        <Button variant="soft" className="min-h-[40px] px-3" onClick={() => void logout().then(onSignedOut)}>
          <LogOut size={16} /> Log out
        </Button>
      </div>
      <SyncRow onDone={onDone} />
      {changing ? (
        <form
          className="space-y-2 rounded-2xl bg-white/80 p-3 ring-1 ring-blush-200"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input className="field" type="password" placeholder="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <input className="field" type="password" placeholder="New password (8+ characters)" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          {next && <p className="text-xs text-ink-soft">Strength: {passwordStrength(next).label}</p>}
          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="ghost" onClick={() => setChanging(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !current || !!passwordStrength(next).error}>
              Save
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" block onClick={() => setChanging(true)}>
          <KeyRound size={18} /> Change password
        </Button>
      )}
    </section>
  );
}

function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="ghost" block className="text-rose-600" onClick={() => setOpen(true)}>
        <Trash2 size={18} /> Delete account and all data
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-2xl bg-blush-100 p-3">
      <p className="text-sm text-rose-700">
        This permanently deletes your account and every log{getSyncStatus().state === 'local' ? ' on this device' : ', on every device and on the server'}. Enter your password to confirm.
      </p>
      <input className="field" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Keep account
        </Button>
        <Button
          className="bg-rose-600"
          disabled={!password}
          onClick={() =>
            void deleteAccount(password)
              .then(onDeleted)
              .catch((e) => setError(e instanceof AuthError ? e.message : 'Could not delete the account.'))
          }
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Home-screen widget                                                   */
/* ------------------------------------------------------------------ */

const ADD_STEPS: Record<'ios' | 'android', string[]> = {
  ios: [
    'Touch and hold an empty spot on your Home Screen until the apps jiggle.',
    'Tap Edit in the top-left corner, then Add Widget (on older iOS versions, tap +). Search for Phase.',
    'Swipe to choose the small or medium size, tap Add Widget, then tap Done.',
  ],
  android: [
    'Touch and hold an empty spot on your home screen.',
    'Tap Widgets, then find Phase in the list.',
    'Touch and hold the Phase widget and drag it where you want it. Resize it to switch between the small and medium layouts.',
  ],
};

function WidgetSection({ snapshot, showCycle }: { snapshot: WidgetSnapshot | null; showCycle: boolean }) {
  const platform = nativePlatform();
  return (
    <section className="space-y-3">
      <h3 className="font-display text-lg text-ink">Home screen widget</h3>
      <p className="text-sm text-ink-soft">See today’s fatigue, sleep, water and stress without opening the app.</p>
      {snapshot && (
        <div className="space-y-3 rounded-2xl bg-cream-200 p-3" data-no-swipe>
          <WidgetMedium metrics={snapshot.metrics} cycle={snapshot.cycle} />
          <div className="flex items-end gap-3">
            <WidgetSmall metrics={snapshot.metrics} cycle={snapshot.cycle} />
            <p className="text-xs text-ink-soft">Preview with today’s data. Empty dashed rings mean that metric hasn’t been logged yet today.</p>
          </div>
        </div>
      )}
      <Row
        icon={<CalendarDays size={18} />}
        title="Show cycle day on widget"
        body="Off by default, so people who see your screen don’t see your cycle."
        on={showCycle}
        onToggle={() => updateSettings({ widgetShowCycle: !showCycle })}
      />
      {platform === 'web' ? (
        <p className="rounded-xl bg-white/80 p-3 text-sm text-ink-soft ring-1 ring-blush-200">
          Home-screen widgets are available in the Phase app for iPhone and Android. In the browser version, you can still add Phase to your home screen as an app icon.
        </p>
      ) : (
        <ol className="list-decimal space-y-1 rounded-xl bg-white/80 p-3 pl-8 text-sm text-ink ring-1 ring-blush-200">
          {ADD_STEPS[platform].map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications                                                        */
/* ------------------------------------------------------------------ */

const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

function whenLabel(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })}, ${time}`;
}

function NotificationsSection({ settings, upcoming }: { settings: NotificationSettings; upcoming: PlannedNotification[] }) {
  const [permission, setPermission] = useState<NotifyPermission>('prompt');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void getPermission().then(setPermission);
  }, [settings.enabled]);

  if (!notificationsSupported()) {
    return (
      <section className="space-y-2">
        <h3 className="font-display text-lg text-ink">Notifications</h3>
        <p className="rounded-xl bg-white/80 p-3 text-sm text-ink-soft ring-1 ring-blush-200">This browser doesn’t support notifications. They’re available in the Phase app for iPhone and Android.</p>
      </section>
    );
  }

  const turnOn = async () => {
    const result = permission === 'granted' ? 'granted' : await requestPermission();
    setPermission(result);
    if (result === 'granted') {
      updateNotificationSettings({ enabled: true });
      setNote(null);
      void enablePush(); // lets notifications arrive while Phase is closed (home-screen web app + synced account)
    } else {
      setNote('Notifications are blocked. You can allow them for Phase in your phone or browser settings.');
    }
  };

  const toggleCategory = (c: NotificationCategory) => updateNotificationSettings({ categories: { ...settings.categories, [c]: !categoryOn(settings, c) } });
  const on = settings.enabled && permission === 'granted';
  const nextWater = upcoming.find((n) => n.category === 'water');
  const others = upcoming.filter((n) => n.category !== 'water');

  return (
    <section className="space-y-3">
      <h3 className="font-display text-lg text-ink">Notifications</h3>
      <p className="text-sm text-ink-soft">Gentle check-ins, comfort on tough days and small celebrations, created on your phone. At most two a day, plus one reminder and, if you like, hourly water reminders.</p>

      <Row
        icon={on ? <Bell size={18} /> : <BellOff size={18} />}
        title="Notifications"
        body={on ? 'On' : permission === 'denied' ? 'Blocked in your settings' : 'Off'}
        on={on}
        onToggle={() => (on ? updateNotificationSettings({ enabled: false }) : void turnOn())}
      />
      {note && <p role="alert" className="rounded-xl bg-blush-100 px-3 py-2 text-sm text-rose-700">{note}</p>}

      {on && (
        <>
          <Row
            icon={<EyeOff size={18} />}
            title="Discreet mode"
            body="The lock screen never mentions your period, cramps or fertility."
            on={settings.discreet}
            onToggle={() => updateNotificationSettings({ discreet: !settings.discreet })}
          />

          <div className="space-y-2 rounded-2xl bg-white/80 p-3 ring-1 ring-blush-200">
            {(Object.keys(CATEGORY_INFO) as NotificationCategory[]).map((c) => (
              <label key={c} className="flex items-start gap-3 py-1">
                <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-rose-500" checked={categoryOn(settings, c)} onChange={() => toggleCategory(c)} />
                <span>
                  <span className="block font-semibold text-ink">{CATEGORY_INFO[c].title}</span>
                  <span className="block text-xs text-ink-soft">{CATEGORY_INFO[c].description}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-3 rounded-2xl bg-white/80 p-3 ring-1 ring-blush-200">
            <Moon size={18} className="shrink-0 text-lilac-500" />
            <span className="flex-1 text-sm font-semibold text-ink">Quiet hours</span>
            <select
              aria-label="Quiet hours start"
              className="rounded-xl bg-cream-100 px-2 py-2 text-ink ring-1 ring-blush-200"
              value={settings.quietStart}
              onChange={(e) => updateNotificationSettings({ quietStart: Number(e.target.value) })}
            >
              {[19, 20, 21, 22, 23].map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
            <span className="text-sm text-ink-soft">to</span>
            <select
              aria-label="Quiet hours end"
              className="rounded-xl bg-cream-100 px-2 py-2 text-ink ring-1 ring-blush-200"
              value={settings.quietEnd}
              onChange={(e) => updateNotificationSettings({ quietEnd: Number(e.target.value) })}
            >
              {[6, 7, 8, 9, 10].map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </div>

          {upcoming.length > 0 && (
            <div className="rounded-2xl bg-cream-200 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Coming up</p>
              {nextWater && (
                <p className="mb-2 flex items-center gap-2 rounded-xl bg-white/90 p-2.5 text-sm text-ink shadow-soft">
                  <Droplet size={16} className="shrink-0 text-sky-500" />
                  <span>
                    <span className="font-semibold">Water reminders</span> every hour. Next: {whenLabel(nextWater.at)}
                  </span>
                </p>
              )}
              <ul className="space-y-2">
                {others.slice(0, 4).map((n) => (
                  <li key={n.key} className="rounded-xl bg-white/90 p-2.5 shadow-soft">
                    <p className="text-[11px] text-ink-faint">{whenLabel(n.at)}</p>
                    <p className="text-sm font-semibold text-ink">{n.title}</p>
                    <p className="text-sm text-ink-soft">{n.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <NotificationCheck />
        </>
      )}
    </section>
  );
}

function NotificationCheck() {
  const [busy, setBusy] = useState<null | 'test' | 'check'>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [steps, setSteps] = useState<CheckStep[] | null>(null);
  const mode = deliveryMode();

  const runTest = async () => {
    setBusy('test');
    setSteps(null);
    try {
      setTest(await sendTestNotification());
    } finally {
      setBusy(null);
    }
  };
  const runCheck = async () => {
    setBusy('check');
    setTest(null);
    try {
      setSteps(await checkNotifications());
    } catch (e) {
      setSteps([{ title: 'Check', state: 'fail', detail: e instanceof Error ? e.message : 'Something went wrong.' }]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      {mode === 'push' || mode === 'native' ? (
        <p className="flex gap-2 rounded-xl bg-sage-100 p-3 text-xs text-sage-600">
          <CheckCircle2 size={16} className="shrink-0" /> Notifications on this device arrive even when Phase is closed.
        </p>
      ) : (
        <p className="flex gap-2 rounded-xl bg-peach-100 p-3 text-xs leading-relaxed text-ink">
          <AlertCircle size={16} className="shrink-0 text-rose-600" />
          <span>
            <span className="font-semibold">Right now, notifications only show while Phase is open.</span> Tap <span className="font-semibold">Check notifications</span> to see
            what’s needed for them to arrive while it’s closed.
          </span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="soft" block disabled={!!busy} onClick={() => void runTest()}>
          <Bell size={18} /> {busy === 'test' ? 'Sending…' : 'Send a test'}
        </Button>
        <Button variant="soft" block disabled={!!busy} onClick={() => void runCheck()}>
          <Stethoscope size={18} /> {busy === 'check' ? 'Checking…' : 'Check notifications'}
        </Button>
      </div>

      {test && (
        <p
          role="status"
          className={cx('rounded-xl p-3 text-sm leading-relaxed', test.ok && test.via !== 'web' ? 'bg-sage-100 text-sage-600' : test.ok ? 'bg-peach-100 text-ink' : 'bg-blush-100 text-rose-700')}
        >
          {test.message}
        </p>
      )}

      {steps && (
        <ol className="space-y-2 rounded-2xl bg-white/80 p-3 ring-1 ring-blush-200" aria-label="Notification check results">
          {steps.map((st) => (
            <li key={st.title} className="flex gap-2.5">
              {st.state === 'ok' ? (
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-sage-600" aria-label="OK" />
              ) : st.state === 'warn' ? (
                <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-500" aria-label="Warning" />
              ) : (
                <XCircle size={18} className="mt-0.5 shrink-0 text-rose-600" aria-label="Problem" />
              )}
              <span>
                <span className="block text-sm font-semibold text-ink">{st.title}</span>
                <span className="block text-xs leading-relaxed text-ink-soft">{st.detail}</span>
              </span>
            </li>
          ))}
          {steps.every((st) => st.state !== 'fail') && (
            <li className="pt-1 text-xs leading-relaxed text-ink-soft">
              Everything looks good. If a notification still doesn’t show up, check that Focus / Do Not Disturb is off, and that Phase is allowed to show notifications
              on the lock screen in your phone’s settings.
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sync status                                                          */
/* ------------------------------------------------------------------ */

function syncLabel(s: ReturnType<typeof getSyncStatus>) {
  switch (s.state) {
    case 'local':
      return 'Stored on this device only';
    case 'synced':
      return `Synced ${new Date(s.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    case 'syncing':
      return 'Syncing…';
    case 'pending':
      return 'Changes waiting to sync';
    case 'offline':
      return 'Offline — changes will sync when you’re back online';
    case 'signin':
      return s.message;
    case 'error':
      return `Couldn’t sync: ${s.message}`;
  }
}

function SyncRow({ onDone }: { onDone: (msg: string) => void }) {
  const status = useSyncStatus();
  const [serverAvailable, setServerAvailable] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeRequired, setCodeRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status.state !== 'local') return;
    void serverInfo().then((info) => {
      setServerAvailable(!!info?.signup.open);
      setCodeRequired(!!info?.signup.codeRequired);
    });
  }, [status.state]);

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPassword('');
      setCode('');
      onDone(done);
    } catch (e) {
      setError(e instanceof AuthError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const local = status.state === 'local';
  const warn = status.state === 'signin' || status.state === 'error';

  return (
    <div className={cx('space-y-2 rounded-2xl bg-white/80 p-3 ring-1', warn ? 'ring-rose-300' : 'ring-blush-200')}>
      <div className="flex items-center gap-3">
        <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', local || status.state === 'offline' ? 'bg-cream-200 text-ink-soft' : 'bg-sage-100 text-sage-600')}>
          {local || status.state === 'offline' ? <CloudOff size={18} /> : <Cloud size={18} />}
        </span>
        <div className="flex-1">
          <p className="text-xs text-ink-faint">{local ? 'Sync' : 'Sync across devices'}</p>
          <p className="text-sm font-semibold text-ink" aria-live="polite">
            {syncLabel(status)}
          </p>
        </div>
        {!local && status.state !== 'signin' && (
          <button
            onClick={() => void sync()}
            aria-label="Sync now"
            disabled={status.state === 'syncing'}
            className="grid h-10 w-10 place-items-center rounded-xl text-ink-soft hover:bg-blush-100 disabled:opacity-40"
          >
            <RefreshCw size={18} className={status.state === 'syncing' ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {status.state === 'signin' && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => reauthenticate(password), 'Signed in again — syncing is back on.');
          }}
        >
          <input className="field" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" block disabled={busy || !password}>
            Sign in to sync
          </Button>
        </form>
      )}

      {local && serverAvailable && (
        <form
          className="space-y-2 border-t border-blush-100 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => enableSync(password, code), 'Sync is on. You can now sign in on any device.');
          }}
        >
          <p className="text-sm text-ink-soft">Turn on sync to sign in on any device with your username and password. Your data stays encrypted.</p>
          <input className="field" type="password" placeholder="Your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {codeRequired && <input className="field" placeholder="Invite code" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="none" />}
          <Button type="submit" variant="soft" block disabled={busy || !password || (codeRequired && !code.trim())}>
            <Cloud size={18} /> Turn on sync
          </Button>
        </form>
      )}

      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}
