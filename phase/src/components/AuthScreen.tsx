import { useEffect, useState } from 'react';
import { Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react';
import { AuthError, hasLegacyData, login, passwordStrength, register, serverInfo, validateUsername } from '../lib/store';
import type { Health } from '../lib/cloud';
import { loadAccounts, loadLastUsername } from '../lib/storage';
import { Button, cx } from './ui';

type Mode = 'signin' | 'signup';

/**
 * Username + password sign-in for on-device accounts.
 * The password never leaves the phone: it derives the key that encrypts the account's data.
 */
export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  /** undefined = still checking; null = no sync server (this-device-only accounts). */
  const [server, setServer] = useState<Health | null | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const [accounts, info] = await Promise.all([loadAccounts(), serverInfo()]);
      setServer(info);
      const last = await loadLastUsername();
      // With a sync server, people often arrive on a new device to sign in, so start there.
      if (!Object.keys(accounts).length && !info) setMode('signup');
      if (last && accounts[last]) setUsername(last);
      setLegacy(!Object.keys(accounts).length && (await hasLegacyData()));
    })();
  }, []);

  const strength = passwordStrength(password);
  const signupError =
    mode === 'signup'
      ? (username && validateUsername(username)) || (password && strength.error) || (confirm && confirm !== password ? 'Passwords don’t match.' : null)
      : null;
  const needsCode = mode === 'signup' && !!server?.signup.codeRequired;
  const signupClosed = mode === 'signup' && !!server && !server.signup.open;
  const canSubmit =
    !busy && username.trim() && password && (mode === 'signin' || (confirm === password && !signupError && !signupClosed && (!needsCode || inviteCode.trim())));

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') await login(username, password, remember);
      else await register(username, password, remember, inviteCode);
    } catch (e) {
      setError(e instanceof AuthError ? e.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setConfirm('');
  };

  return (
    <main className="app-shell flex flex-col justify-center">
      <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-[22px] bg-blush-200 shadow-soft">
        <svg viewBox="0 0 64 64" className="h-10 w-10" aria-hidden>
          <circle cx="32" cy="32" r="17" fill="#FFF8F2" stroke="#E07A7F" strokeWidth="5" />
          <path d="M32 15a17 17 0 0 1 0 34z" fill="#E07A7F" />
        </svg>
      </div>
      <h1 className="text-center font-display text-3xl text-ink">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
      <p className="mt-1 text-center text-ink-soft">{mode === 'signin' ? 'Sign in to Phase' : 'Your private space for your cycle'}</p>

      <div className="mt-6 grid grid-cols-2 rounded-2xl bg-blush-100 p-1" role="tablist">
        {(['signin', 'signup'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => switchMode(m)}
            className={cx('min-h-[40px] rounded-xl text-sm font-semibold transition', mode === m ? 'bg-white text-ink shadow-soft' : 'text-ink-soft')}
          >
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      <form
        className="mt-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Username</span>
          <input
            className="field"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="e.g. maya"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Password</span>
          <div className="relative">
            <input
              className="field pr-12"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? 'Hide password' : 'Show password'}
              className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-xl text-ink-faint"
            >
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>
        {mode === 'signup' && password && (
          <div className="flex items-center gap-2" aria-live="polite">
            <div className="flex flex-1 gap-1">
              {[1, 2, 3].map((i) => (
                <span key={i} className={cx('h-1.5 flex-1 rounded-full', strength.score >= i ? ['', 'bg-peach-400', 'bg-sage-400', 'bg-sage-600'][strength.score] : 'bg-blush-200')} />
              ))}
            </div>
            <span className="w-16 text-right text-xs text-ink-soft">{strength.label}</span>
          </div>
        )}
        {mode === 'signup' && (
          <label className="block animate-fade-up">
            <span className="mb-1 block text-sm font-semibold text-ink">Confirm password</span>
            <input className="field" type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </label>
        )}

        {needsCode && (
          <label className="block animate-fade-up">
            <span className="mb-1 block text-sm font-semibold text-ink">Invite code</span>
            <input
              className="field"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="From the person who invited you"
            />
          </label>
        )}
        {signupClosed && (
          <p className="rounded-xl bg-blush-100 px-3 py-2 text-sm text-rose-700">Phase isn’t accepting new accounts right now. If you already have one, sign in instead.</p>
        )}

        <label className="flex items-center gap-2.5 py-1 text-sm text-ink">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-5 w-5 accent-rose-500" />
          Keep me signed in on this device
        </label>

        {(error || signupError) && (
          <p role="alert" className="rounded-xl bg-blush-100 px-3 py-2 text-sm text-rose-700">
            {error ?? signupError}
          </p>
        )}

        <Button block type="submit" disabled={!canSubmit}>
          {busy ? <LoaderCircle size={18} className="animate-spin" /> : mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
      </form>

      {mode === 'signup' && legacy && (
        <p className="mt-4 rounded-xl bg-sage-100 px-3 py-2 text-sm text-sage-600">We found data from before accounts existed. It will be moved into this new account.</p>
      )}

      <div className="mt-6 flex gap-2.5 rounded-2xl bg-white/70 p-3 text-xs text-ink-soft ring-1 ring-blush-200">
        <ShieldCheck size={18} className="shrink-0 text-sage-600" />
        {server ? (
          <p>
            Sign in on any device with your username and password. Your data is encrypted on your device before it’s synced, so not even the Phase server can read
            it. That also means a forgotten password can’t be reset, so choose one you’ll remember.
          </p>
        ) : (
          <p>
            Your account lives only on this device and your data is encrypted with your password. There’s no cloud copy, so if you forget your password it can’t be
            reset — export a backup from Settings now and then.
          </p>
        )}
      </div>
    </main>
  );
}
