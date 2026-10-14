import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ISODate } from './types';
import { boot, flush, loadDemoData, logout, useAuthStatus, usePhaseData } from './lib/store';
import { requestPersistence } from './lib/storage';
import { buildDemoData } from './lib/demoData';
import { buildWidgetSnapshot } from './lib/dayMetrics';
import { syncWidget } from './lib/widgetBridge';
import { DEFAULT_NOTIFICATION_SETTINGS, nextNotificationLog, planNotifications, sameLog, type PlannedNotification } from './lib/notifications';
import { getPermission, setOnShown, syncNotifications } from './lib/notifier';
import InAppNotice from './components/InAppNotice';
import IntroTour from './components/IntroTour';
import { updateSettings } from './lib/store';
import { getState, setNotificationLog } from './lib/store';
import { useUpdateAvailable } from './lib/pwa';
import { useToday } from './hooks/useToday';
import { useCycle } from './hooks/useCycle';
import AuthScreen from './components/AuthScreen';
import OnboardingWizard from './components/OnboardingWizard';
import Dashboard from './components/Dashboard';
import SymptomCheck from './components/SymptomCheck';
import InsightsScreen from './components/InsightsScreen';
import BottomNav, { type Tab } from './components/BottomNav';
import PeriodLogger from './components/PeriodLogger';
import DailyDetails from './components/DailyDetails';
import SettingsSheet from './components/SettingsSheet';
import LockScreen from './components/LockScreen';
import InstallBanner from './components/InstallBanner';

const RELOCK_AFTER_MS = 60_000;
const AUTO_LOGGER_KEY = 'phase:auto-logger-shown';

export default function App() {
  const auth = useAuthStatus();
  const data = usePhaseData();
  const today = useToday();
  const model = useCycle(data, today);
  const { prediction, status, insight, suggestions } = model;

  const [tab, setTab] = useState<Tab>('today');
  /** Day shown on Home; null means "today" (so it follows the date at midnight). */
  const [pickedDate, setPickedDate] = useState<ISODate | null>(null);
  const viewDate = pickedDate && pickedDate < today ? pickedDate : today;
  const [locked, setLocked] = useState(false);
  const [logger, setLogger] = useState<{ date: ISODate; defaultPeriod: boolean } | null>(null);
  const [detailsDate, setDetailsDate] = useState<ISODate | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hiddenAt = useRef<number | null>(null);
  const prevAuth = useRef(auth);
  const { available: updateReady, update } = useUpdateAvailable();

  /* ---- boot: restore a remembered session */
  useEffect(() => {
    void boot();
  }, []);

  /* ---- lock only when a session was restored (a fresh sign-in just proved the password) */
  useEffect(() => {
    if (prevAuth.current === 'booting' && auth === 'signed-in') setLocked(data.settings.lockEnabled);
    if (auth === 'signed-out') {
      setTab('today');
      setPickedDate(null);
      setLocked(false);
      setLogger(null);
      setDetailsDate(null);
      setSettingsOpen(false);
    }
    prevAuth.current = auth;
  }, [auth]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (data.profile) void requestPersistence();
  }, [data.profile]);

  /* ---- keep the native home-screen widget up to date (no-op in the browser) */
  const widgetSnapshot = useMemo(
    () =>
      auth === 'signed-in' && data.profile
        ? buildWidgetSnapshot({ today, logs: data.logs, profile: data.profile, status, showCycle: !!data.settings.widgetShowCycle })
        : null,
    [auth, data.profile, data.logs, data.settings.widgetShowCycle, status, today],
  );
  useEffect(() => {
    if (auth !== 'booting') void syncWidget(widgetSnapshot);
  }, [auth, widgetSnapshot]);

  /* ---- notifications: re-plan whenever data changes, every few minutes, and when the app comes back */
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setClock(Date.now());
    const id = setInterval(tick, 5 * 60_000);
    const onVis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  const [upcoming, setUpcoming] = useState<PlannedNotification[]>([]);
  // Web: remember a notification as sent only once it has actually been shown.
  useEffect(() => {
    setOnShown((key, at) => setNotificationLog({ ...(getState().notificationLog ?? {}), [key]: at }));
    return () => setOnShown(null);
  }, []);
  const notif = data.settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS;
  useEffect(() => {
    if (auth === 'booting') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (auth !== 'signed-in' || !data.profile || !notif.enabled || (await getPermission()) !== 'granted') {
        if (!cancelled) setUpcoming([]);
        await syncNotifications([]);
        return;
      }
      const now = Date.now();
      const plan = planNotifications({ data, now, today, prediction: model.prediction, status: model.status, stats: model.stats, findings: model.findings });
      if (cancelled) return;
      setUpcoming(plan);
      const mode = await syncNotifications(plan);
      // The app and push both schedule ahead, so planned items count as sent; in the browser-only mode only shown ones do.
      const nextLog = nextNotificationLog(data.notificationLog, mode !== 'web' ? plan : [], now);
      if (!sameLog(data.notificationLog, nextLog)) setNotificationLog(nextLog);
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [auth, data, today, model, notif.enabled, clock]);

  /* ---- dev helper: /?demo=1 fills the signed-in account with sample cycles */
  useEffect(() => {
    if (!import.meta.env.DEV || auth !== 'signed-in') return;
    if (new URLSearchParams(location.search).get('demo') === '1') {
      loadDemoData(buildDemoData(today));
      history.replaceState(null, '', location.pathname);
    }
  }, [auth]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- persist on background, re-lock after a while away */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        void flush();
      } else if (hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_AFTER_MS && data.settings.lockEnabled) {
        setLocked(true);
        setLogger(null);
        setDetailsDate(null);
        setSettingsOpen(false);
      }
    };
    const onHide = () => void flush();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
    };
  }, [data.settings.lockEnabled]);

  const isLocked = locked && data.settings.lockEnabled;
  const ready = auth === 'signed-in' && !!data.profile && !isLocked;

  /* ---- home-screen shortcut: /?action=log */
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(location.search);
    if (params.get('action') === 'log') {
      setLogger({ date: today, defaultPeriod: status.onPeriod });
      history.replaceState(null, '', location.pathname);
    }
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- surface the fast logger automatically on active period days */
  useEffect(() => {
    if (!ready || !status.onPeriod || tab !== 'today') return;
    const log = data.logs[today];
    const alreadyLogged = !!log && (!!log.symptoms.cramps || !!log.cycle.flow || log.symptoms.moods.length > 0);
    const key = `${AUTO_LOGGER_KEY}:${data.username ?? ''}`;
    let shown: string | null = null;
    try {
      shown = sessionStorage.getItem(key);
    } catch {
      /* ignore */
    }
    if (alreadyLogged || shown === today) return;
    try {
      sessionStorage.setItem(key, today);
    } catch {
      /* ignore */
    }
    const id = setTimeout(() => setLogger({ date: today, defaultPeriod: true }), 600);
    return () => clearTimeout(id);
  }, [ready, status.onPeriod, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const openLogger = useCallback((date: ISODate, defaultPeriod: boolean) => setLogger({ date, defaultPeriod }), []);
  const closeLogger = useCallback(() => setLogger(null), []);
  const closeDetails = useCallback(() => setDetailsDate(null), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const changeTab = useCallback((t: Tab) => {
    setTab(t);
    if (t !== 'today') setPickedDate(null);
    window.scrollTo({ top: 0 });
  }, []);

  if (auth === 'booting') {
    return (
      <div className="grid min-h-[100dvh] place-items-center" aria-busy="true">
        <div className="h-10 w-10 animate-breathe rounded-full bg-blush-200" />
      </div>
    );
  }

  if (auth === 'signed-out') return <AuthScreen />;

  if (isLocked) return <LockScreen settings={data.settings} onUnlock={() => setLocked(false)} onForgot={() => void logout()} />;

  const tour = data.settings.showIntro ? <IntroTour onDone={() => updateSettings({ showIntro: false })} /> : null;

  if (!data.profile)
    return (
      <>
        <OnboardingWizard today={today} />
        {tour}
      </>
    );

  return (
    <>
      {tab === 'today' && (
        <Dashboard
          data={data}
          today={today}
          viewDate={viewDate}
          onChangeDate={(d) => setPickedDate(d >= today ? null : d)}
          prediction={prediction}
          status={status}
          insight={insight}
          suggestions={suggestions}
          onOpenLogger={openLogger}
          onOpenDetails={setDetailsDate}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenInsights={() => changeTab('insights')}
        />
      )}
      {tab === 'symptoms' && <SymptomCheck today={today} phase={status.phase} log={data.logs[today]} />}
      {tab === 'insights' && <InsightsScreen data={data} today={today} model={model} />}

      <BottomNav tab={tab} onChange={changeTab} />

      <InAppNotice />
      {tour}

      <PeriodLogger
        open={!!logger}
        date={logger?.date ?? today}
        log={logger ? data.logs[logger.date] : undefined}
        defaultPeriod={logger?.defaultPeriod ?? false}
        onClose={closeLogger}
        onMoreDetails={() => {
          const d = logger?.date ?? today;
          setLogger(null);
          setDetailsDate(d);
        }}
      />

      <DailyDetails
        open={!!detailsDate}
        date={detailsDate ?? today}
        log={detailsDate ? data.logs[detailsDate] : undefined}
        tempUnit={data.settings.tempUnit}
        onClose={closeDetails}
      />

      <SettingsSheet open={settingsOpen} onClose={closeSettings} data={data} widgetSnapshot={widgetSnapshot} upcoming={upcoming} />

      {!logger && !detailsDate && !settingsOpen && <InstallBanner settings={data.settings} />}

      {updateReady && (
        <button
          onClick={() => void update()}
          className="fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-cream shadow-lift"
        >
          <RefreshCw size={15} /> Update available — tap to refresh
        </button>
      )}
    </>
  );
}
