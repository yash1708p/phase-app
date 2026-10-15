/**
 * End-to-end: two "devices" (separate local databases and app instances)
 * syncing through a real in-memory server.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../server/app';
import { sqliteAdapter } from '../../server/db';

import { SCHEMA as schema } from '../../server/schema';
const PW = 'correct horse 1';
const CODE = 'friends';
const profile = { age: 29, primaryGoal: 'track_period' as const, typicalCycleLength: 28, typicalPeriodLength: 5 };

let server: ReturnType<typeof createApp>;
let online = true;

beforeAll(() => {
  server = createApp({ db: sqliteAdapter(new DatabaseSync(':memory:'), schema), secret: 'test-secret-that-is-long-enough', signupCode: CODE });
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (!online) throw new TypeError('Failed to fetch');
    return server.request(url, init);
  }) as typeof fetch;
});

afterEach(() => {
  online = true;
});

/** A fresh device: its own IndexedDB and a fresh copy of the app modules. */
async function device() {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  return import('../lib/store');
}

describe('sync across devices', () => {
  it('signs in on a second device and sees the same data', async () => {
    const a = await device();
    await expect(a.register('maya', PW, true, 'wrong')).rejects.toThrow(/invite code/);
    await a.register('maya', PW, true, CODE);
    a.completeOnboarding(profile, '2026-10-01', '2026-10-05');
    a.saveLog('2026-10-10', (l) => ({ ...l, symptoms: { ...l.symptoms, cramps: 'mild' } }));
    await a.flush();
    expect(a.getSyncStatus().state).toBe('synced');

    const b = await device();
    await expect(b.login('maya', 'wrong password', false)).rejects.toThrow(/incorrect/);
    await b.login('maya', PW, false);
    expect(b.getState().profile).toEqual(profile);
    expect(b.getState().periodDays).toHaveLength(5);
    expect(b.getState().logs['2026-10-10'].symptoms.cramps).toBe('mild');
    await b.logout();
    await a.logout();
  });

  it('merges edits made on two devices at the same time', async () => {
    const a = await device();
    await a.register('lena', PW, false, CODE);
    a.completeOnboarding(profile, '2026-10-01', '2026-10-04');
    await a.flush();

    const b = await device();
    await b.login('lena', PW, false);

    // Both devices edit before either syncs.
    b.saveLog('2026-10-11', (l) => ({ ...l, lifestyle: { ...l.lifestyle, waterGlasses: 6 } }));
    await b.flush();
    a.saveLog('2026-10-12', (l) => ({ ...l, lifestyle: { ...l.lifestyle, sleepHours: 7.5 } }));
    await a.flush(); // conflict → merge → upload

    await b.sync();
    for (const s of [a.getState(), b.getState()]) {
      expect(s.logs['2026-10-11'].lifestyle.waterGlasses).toBe(6);
      expect(s.logs['2026-10-12'].lifestyle.sleepHours).toBe(7.5);
    }
  });

  it('works offline from the cached copy and uploads when back online', async () => {
    const a = await device();
    await a.register('zoe', PW, false, CODE);
    a.completeOnboarding(profile, '2026-10-01', '2026-10-05');
    await a.flush();
    await a.logout();

    online = false;
    const again = await device();
    // A device that has never seen the account can't sign in offline…
    await expect(again.login('zoe', PW, false)).rejects.toThrow(/offline/);

    online = true;
    const b = await device();
    await b.login('zoe', PW, true);
    await b.logout();

    // …but one that has, can.
    online = false;
    await b.login('zoe', PW, false);
    expect(b.getState().profile).toEqual(profile);
    b.saveLog('2026-10-13', (l) => ({ ...l, symptoms: { ...l.symptoms, moods: ['calm'] } }));
    await b.flush();
    expect(b.getSyncStatus().state).toBe('offline');

    online = true;
    await b.sync();
    expect(b.getSyncStatus().state).toBe('synced');

    const c = await device();
    await c.login('zoe', PW, false);
    expect(c.getState().logs['2026-10-13'].symptoms.moods).toEqual(['calm']);
  });

  it('keeps PIN lock and notification settings per device', async () => {
    const a = await device();
    await a.register('ivy', PW, false, CODE);
    a.completeOnboarding(profile, '2026-10-01', '2026-10-05');
    a.updateSettings({ lockEnabled: true, pinHash: 'x', pinSalt: 'y' });
    a.updateSettings({ tempUnit: 'F' });
    await a.flush();

    const b = await device();
    await b.login('ivy', PW, false);
    expect(b.getState().settings.lockEnabled).toBe(false);
    expect(b.getState().settings.tempUnit).toBe('F');
  });

  it('after a password change, other devices are asked to sign in again', async () => {
    const a = await device();
    await a.register('nora', PW, false, CODE);
    a.completeOnboarding(profile, '2026-10-01', '2026-10-05');
    await a.flush();
    const b = await device();
    await b.login('nora', PW, false);

    await a.changePassword(PW, 'brand new pass 2');
    await b.sync();
    expect(b.getSyncStatus().state).toBe('signin');
    await b.reauthenticate('brand new pass 2');
    expect(b.getSyncStatus().state).toBe('synced');

    const c = await device();
    await expect(c.login('nora', PW, false)).rejects.toThrow(/incorrect/);
    await c.login('nora', 'brand new pass 2', false);
    expect(c.getState().profile).toEqual(profile);
  });

  it('moves a this-device-only account onto the server', async () => {
    online = false;
    const a = await device();
    await a.register('ruby', PW, true); // no server reachable → local account
    a.completeOnboarding(profile, '2026-10-02', '2026-10-06');
    await a.flush();
    expect(a.getSyncStatus().state).toBe('local');

    online = true;
    await a.enableSync(PW, CODE);
    expect(a.getSyncStatus().state).toBe('synced');

    const b = await device();
    await b.login('ruby', PW, false);
    expect(b.getState().periodDays[0]).toBe('2026-10-02');
  });

  it('deletes the account everywhere', async () => {
    const a = await device();
    await a.register('gone', PW, false, CODE);
    await a.deleteAccount(PW);
    const b = await device();
    await expect(b.login('gone', PW, false)).rejects.toThrow(/incorrect/);
  });
});
