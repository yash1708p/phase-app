/**
 * Cloudflare Workers entry for the Phase server (accounts, sync and push
 * notifications). The app itself is hosted on Vercel, which forwards /api/*
 * here (see vercel.json). A cron trigger runs every minute to send due
 * notifications.
 */
import { createApp } from './app';
import { d1Adapter } from './db';
import { processQueue } from './push';
import { SCHEMA } from './schema';

interface Env {
  DB: Parameters<typeof d1Adapter>[0];
  PHASE_SECRET?: string;
  SIGNUP_CODE?: string;
  MAX_USERS?: string;
  PUSH_SUBJECT?: string;
}

const make = (env: Env) => {
  const db = d1Adapter(env.DB, SCHEMA);
  return {
    db,
    app: createApp({
      db,
      secret: env.PHASE_SECRET || undefined,
      signupCode: env.SIGNUP_CODE || undefined,
      maxUsers: env.MAX_USERS ? Number(env.MAX_USERS) : undefined,
      pushSubject: env.PUSH_SUBJECT || undefined,
    }),
  };
};

export default {
  fetch(request: Request, env: Env, ctx: unknown) {
    return make(env).app.fetch(request, env, ctx as never);
  },
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const { db } = make(env);
    ctx.waitUntil(
      (async () => {
        await db.init();
        await processQueue(db, { subject: env.PUSH_SUBJECT || 'mailto:phase-app@users.noreply.github.com' });
      })(),
    );
  },
};
