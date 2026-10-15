/**
 * Run Phase (web app + sync server) on any Node host.
 *
 *   npm run build            # build the web app into dist/
 *   PHASE_SECRET=... npm run server
 *
 * Environment:
 *   PHASE_SECRET   optional — generated and stored in the database if not set
 *   SIGNUP_CODE    optional — invite code people need to create an account
 *   MAX_USERS      optional — account limit (default 25)
 *   DB_PATH        optional — SQLite file (default ./data/phase.db)
 *   PORT           optional — default 8787
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app';
import { processQueue } from './push';
import { sqliteAdapter } from './db';
import { SCHEMA } from './schema';


const dbPath = resolve(process.env.DB_PATH ?? 'data/phase.db');
mkdirSync(dirname(dbPath), { recursive: true });
const db = sqliteAdapter(new DatabaseSync(dbPath), SCHEMA);

const api = createApp({
  db,
  secret: process.env.PHASE_SECRET || undefined,
  signupCode: process.env.SIGNUP_CODE || undefined,
  maxUsers: process.env.MAX_USERS ? Number(process.env.MAX_USERS) : undefined,
});

const root = new Hono();
root.route('/', api);
// The built web app; unknown paths fall back to index.html (single-page app).
root.use('/*', serveStatic({ root: './dist' }));
root.get('*', serveStatic({ path: './dist/index.html' }));

const port = Number(process.env.PORT ?? 8787);
// Send due notifications every minute.
setInterval(() => void processQueue(db, { subject: process.env.PUSH_SUBJECT || 'mailto:phase-app@users.noreply.github.com' }).catch(() => undefined), 60_000);

serve({ fetch: root.fetch, port }, () => console.log(`Phase is running on http://localhost:${port}  (data: ${dbPath})`));
