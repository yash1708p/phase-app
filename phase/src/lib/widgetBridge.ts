/**
 * Bridge to the native home-screen widget (iOS WidgetKit / Android App Widget).
 *
 * The web app can't draw on the home screen itself, so in the App Store /
 * Google Play builds (Capacitor) it hands a small JSON snapshot to the native
 * side, which stores it where the widget can read it. In a normal browser or
 * installed PWA this is a no-op.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { WidgetSnapshot } from './dayMetrics';

interface PhaseWidgetPlugin {
  update(options: { json: string }): Promise<void>;
  clear(): Promise<void>;
}

const PhaseWidget = registerPlugin<PhaseWidgetPlugin>('PhaseWidget');

export const widgetsSupported = () => Capacitor.isNativePlatform();
export const nativePlatform = () => Capacitor.getPlatform() as 'ios' | 'android' | 'web';

let lastSent = '';

/** Push the latest snapshot (or null to clear, e.g. on log out). Skips identical updates. */
export async function syncWidget(snapshot: WidgetSnapshot | null): Promise<void> {
  if (!widgetsSupported()) return;
  try {
    if (!snapshot) {
      if (lastSent === 'cleared') return;
      lastSent = 'cleared';
      await PhaseWidget.clear();
      return;
    }
    const { updatedAt: _ignored, ...content } = snapshot;
    const key = JSON.stringify(content);
    if (key === lastSent) return;
    lastSent = key;
    await PhaseWidget.update({ json: JSON.stringify(snapshot) });
  } catch (err) {
    console.warn('[Phase] Widget update failed', err);
  }
}
