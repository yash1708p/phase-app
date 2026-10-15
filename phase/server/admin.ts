/**
 * Small admin tool for the Node server's database.
 *
 *   npm run admin -- list               # usernames and sign-up dates
 *   npm run admin -- delete <username>  # remove an account and its data
 *   npm run admin -- signout <username> # sign the user out on every device
 *
 * The server can't see anyone's health data, only usernames and dates.
 * (For Cloudflare, see docs/SERVER.md for the equivalent `wrangler d1` commands.)
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sqliteAdapter } from './db';
import { SCHEMA } from './schema';

const dbPath = resolve(process.env.DB_PATH ?? 'data/phase.db');
if (!existsSync(dbPath)) {
  console.log(`No database at ${dbPath} yet. Start the server once (npm run server), or set DB_PATH.`);
  process.exit(0);
}
const db = sqliteAdapter(new DatabaseSync(dbPath), SCHEMA);
const [cmd, arg] = process.argv.slice(2);

async function main() {
  if (cmd === 'list') {
    const rows = await db.all<{ username: string; created_at: number; updated_at: number | null }>(
      'SELECT u.username, u.created_at, v.updated_at FROM users u LEFT JOIN vaults v ON v.user_id = u.id ORDER BY u.created_at',
    );
    if (!rows.length) return console.log('No accounts yet.');
    for (const r of rows) {
      console.log(`${r.username.padEnd(24)} joined ${new Date(r.created_at).toISOString().slice(0, 10)}   last synced ${r.updated_at ? `${new Date(r.updated_at).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—'}`);
    }
    console.log(`\n${rows.length} account${rows.length === 1 ? '' : 's'}`);
  } else if ((cmd === 'delete' || cmd === 'signout') && arg) {
    const user = await db.get<{ id: number }>('SELECT id FROM users WHERE username = ?', arg.toLowerCase());
    if (!user) return console.log(`No account called "${arg}".`);
    await db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
    if (cmd === 'delete') {
      await db.run('DELETE FROM vaults WHERE user_id = ?', user.id);
      await db.run('DELETE FROM users WHERE id = ?', user.id);
      console.log(`Deleted "${arg}" and all of their data.`);
    } else {
      console.log(`Signed "${arg}" out on every device.`);
    }
  } else {
    console.log('Usage: npm run admin -- list | delete <username> | signout <username>');
  }
}
void main();
