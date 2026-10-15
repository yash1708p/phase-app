/**
 * Service worker registration + "Add to Home Screen" plumbing.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { Capacitor } from '@capacitor/core';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let needRefresh = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function initPWA() {
  if (typeof window === 'undefined') return;
  // Inside the native app the web files ship with the app, so no service worker or install banner.
  if (Capacitor.isNativePlatform()) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // show our own banner instead of the mini-infobar
    deferredPrompt = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    emit();
  });

  if ('serviceWorker' in navigator) {
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        needRefresh = true;
        emit();
      },
    });
  }
}

export const isStandalone = () =>
  Capacitor.isNativePlatform() ||
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function useInstallPrompt() {
  const canPrompt = useSyncExternalStore(subscribe, () => deferredPrompt !== null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onChange = () => setInstalled(isStandalone());
    mq?.addEventListener?.('change', onChange);
    return () => mq?.removeEventListener?.('change', onChange);
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    emit();
    return outcome === 'accepted';
  };

  return { canPrompt, installed, iosManual: isIOS() && !installed, promptInstall };
}

export function useUpdateAvailable() {
  const available = useSyncExternalStore(subscribe, () => needRefresh);
  return { available, update: () => updateSW?.(true) };
}
