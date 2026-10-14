import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../server/app';
import { sqliteAdapter } from '../../server/db';

import { SCHEMA as schema } from '../../server/schema';
const KEY_A = 'a'.repeat(43);
const KEY_B = 'b'.repeat(43);
const vault = (n = 1) => ({ iv: 'aXZpdml2aXZpdml2', ciphertext: `Y2lwaGVy${n}` });

function setup(opts: { signupCode?: string; maxUsers?: number } = {}) {
  let t = 1_700_000_000_000;
  const app = createApp({ db: sqliteAdapter(new DatabaseSync(':memory:'), schema), secret: 'test-secret-that-is-long-enough', now: () => t, ...opts });
  const req = (path: string, init: { method?: string; body?: unknown; token?: string; ip?: string } = {}) =>
    app.request(`/api${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': init.ip ?? '1.1.1.1',
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  const json = async (r: Response | Promise<Response>) => {
    const res = await r;
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  return { req, json, advance: (ms: number) => (t += ms) };
}

const signup = (s: ReturnType<typeof setup>, username = 'maya', extra: object = {}) =>
  s.json(s.req('/register', { body: { username, salt: 'c2FsdHNhbHRzYWx0c2FsdA', iterations: 310000, authKey: KEY_A, vault: vault(), ...extra } }));

describe('sync server', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => (s = setup({ signupCode: 'friends-2026', maxUsers: 2 })));

  it('reports health and sign-up rules', async () => {
    expect((await s.json(s.req('/health'))).body).toEqual({ ok: true, signup: { open: true, codeRequired: true } });
  });

  it('requires the invite code and respects the account limit', async () => {
    expect((await signup(s, 'maya', { inviteCode: 'wrong' })).status).toBe(403);
    expect((await signup(s, 'maya', { inviteCode: 'friends-2026' })).status).toBe(201);
    expect((await signup(s, 'maya', { inviteCode: 'friends-2026' })).status).toBe(409);
    expect((await signup(s, 'lena', { inviteCode: 'friends-2026' })).status).toBe(201);
    const full = await signup(s, 'zoe', { inviteCode: 'friends-2026' });
    expect(full.status).toBe(403);
    expect(full.body.error).toMatch(/full/);
    expect((await s.json(s.req('/health'))).body.signup.open).toBe(false);
  });

  it('logs in from another device and returns the encrypted data', async () => {
    await signup(s, 'Maya', { inviteCode: 'friends-2026' });
    const pre = await s.json(s.req('/prelogin', { body: { username: 'maya' } }));
    expect(pre.body).toEqual({ salt: 'c2FsdHNhbHRzYWx0c2FsdA', iterations: 310000 });
    const bad = await s.json(s.req('/login', { body: { username: 'maya', authKey: KEY_B } }));
    expect(bad.status).toBe(401);
    const ok = await s.json(s.req('/login', { body: { username: 'MAYA', authKey: KEY_A } }));
    expect(ok.status).toBe(200);
    expect(ok.body.vault).toEqual(vault());
    expect(ok.body.version).toBe(1);
  });

  it('gives unknown usernames a stable fake salt (no account probing)', async () => {
    const a = await s.json(s.req('/prelogin', { body: { username: 'nobody' } }));
    const b = await s.json(s.req('/prelogin', { body: { username: 'nobody' } }));
    expect(a.body.salt).toBe(b.body.salt);
    expect(a.body.iterations).toBe(310000);
  });

  it('versions data and reports conflicts with the newer copy', async () => {
    const { body } = await signup(s, 'maya', { inviteCode: 'friends-2026' });
    const token = body.token;
    expect((await s.json(s.req('/vault?since=1', { token }))).status).toBe(204);
    const put = await s.json(s.req('/vault', { method: 'PUT', token, body: { vault: vault(2), baseVersion: 1 } }));
    expect(put.body.version).toBe(2);
    const stale = await s.json(s.req('/vault', { method: 'PUT', token, body: { vault: vault(3), baseVersion: 1 } }));
    expect(stale.status).toBe(409);
    expect(stale.body.vault).toEqual(vault(2));
    expect(stale.body.version).toBe(2);
    expect((await s.json(s.req('/vault?since=1', { token }))).body.version).toBe(2);
  });

  it('rejects requests without a valid session', async () => {
    expect((await s.json(s.req('/vault'))).status).toBe(401);
    expect((await s.json(s.req('/vault', { token: 'nope' }))).status).toBe(401);
  });

  it('expires sessions after 60 days', async () => {
    const { body } = await signup(s, 'maya', { inviteCode: 'friends-2026' });
    s.advance(61 * 86_400_000);
    expect((await s.json(s.req('/vault', { token: body.token }))).status).toBe(401);
  });

  it('locks a username after 10 wrong passwords', async () => {
    await signup(s, 'maya', { inviteCode: 'friends-2026' });
    for (let i = 0; i < 10; i++) await s.req('/login', { body: { username: 'maya', authKey: KEY_B }, ip: `9.9.9.${i}` });
    const locked = await s.json(s.req('/login', { body: { username: 'maya', authKey: KEY_A } }));
    expect(locked.status).toBe(429);
    s.advance(16 * 60_000);
    expect((await s.json(s.req('/login', { body: { username: 'maya', authKey: KEY_A } }))).status).toBe(200);
  });

  it('changes the password, signing out other devices', async () => {
    const { body } = await signup(s, 'maya', { inviteCode: 'friends-2026' });
    const other = (await s.json(s.req('/login', { body: { username: 'maya', authKey: KEY_A } }))).body.token;
    const wrong = await s.json(s.req('/password', { token: body.token, body: { authKey: KEY_B, newSalt: 'bmV3c2FsdG5ld3NhbHQxMjM', newIterations: 310000, newAuthKey: KEY_B, vault: vault(9) } }));
    expect(wrong.status).toBe(403);
    const ok = await s.json(s.req('/password', { token: body.token, body: { authKey: KEY_A, newSalt: 'bmV3c2FsdG5ld3NhbHQxMjM', newIterations: 310000, newAuthKey: KEY_B, vault: vault(9) } }));
    expect(ok.status).toBe(200);
    expect((await s.json(s.req('/vault', { token: other }))).status).toBe(401);
    expect((await s.json(s.req('/login', { body: { username: 'maya', authKey: KEY_B } }))).body.vault).toEqual(vault(9));
  });

  it('deletes an account and its data', async () => {
    const { body } = await signup(s, 'maya', { inviteCode: 'friends-2026' });
    expect((await s.json(s.req('/account', { method: 'DELETE', token: body.token, body: { authKey: KEY_B } }))).status).toBe(403);
    expect((await s.json(s.req('/account', { method: 'DELETE', token: body.token, body: { authKey: KEY_A } }))).status).toBe(200);
    expect((await s.json(s.req('/login', { body: { username: 'maya', authKey: KEY_A } }))).status).toBe(401);
  });

  it('validates input', async () => {
    expect((await signup(s, 'a', { inviteCode: 'friends-2026' })).status).toBe(400);
    expect((await signup(s, 'maya', { inviteCode: 'friends-2026', authKey: 'short' })).status).toBe(400);
    expect((await s.json(s.req('/register', { body: 'not json' }))).status).toBe(403); // no invite code
  });
});
