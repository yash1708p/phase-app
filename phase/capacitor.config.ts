import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native wrapper for the App Store / Google Play builds (needed for home-screen widgets).
 * Change appId to your own reverse-domain ID before publishing, and update the
 * matching IDs in native/ (see docs/WIDGETS.md).
 */
const config: CapacitorConfig = {
  appId: 'com.phase.app',
  appName: 'Phase',
  webDir: 'dist',
  plugins: {
    LocalNotifications: {
      // Android status-bar icon (copied from native/android/.../res/drawable/ic_stat_phase.xml).
      smallIcon: 'ic_stat_phase',
      iconColor: '#E07A7F',
    },
  },
};

export default config;
