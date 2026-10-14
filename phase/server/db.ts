/**
 * Tiny async SQL interface so the same server code runs on
 * Node (built-in node:sqlite) and Cloudflare Workers (D1).
 */
export interface DB {
  /** Create tables if they don't exist yet (idempotent). */
  init(): Promise<void>;
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
}

/* ------------------------------------------------------------------ */
/* Cloudflare D1                                                        */
/* ------------------------------------------------------------------ */

interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
      run(): Promise<{ meta: { changes?: number } }>;
    };
  };
}

/** Split a schema file into statements (drops `--` comments). */
export const statements = (schema: string) =>
  schema
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

export function d1Adapter(d1: D1Like, schema: string): DB {
  let ready: Promise<void> | null = null;
  return {
    init: () =>
      (ready ??= (async () => {
        for (const sql of statements(schema)) await d1.prepare(sql).bind().run();
      })().catch((e) => {
        ready = null;
        throw e;
      })),
    get: async <T>(sql: string, ...p: unknown[]) => (await d1.prepare(sql).bind(...p).first<T>()) ?? undefined,
    all: async <T>(sql: string, ...p: unknown[]) => (await d1.prepare(sql).bind(...p).all<T>()).results,
    run: async (sql: string, ...p: unknown[]) => ({ changes: (await d1.prepare(sql).bind(...p).run()).meta.changes ?? 0 }),
  };
}

/* ------------------------------------------------------------------ */
/* Node (node:sqlite)                                                   */
/* ------------------------------------------------------------------ */

interface SqliteLike {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...p: unknown[]): unknown;
    all(...p: unknown[]): unknown[];
    run(...p: unknown[]): { changes: number | bigint };
  };
}

export function sqliteAdapter(db: SqliteLike, schema: string): DB {
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(schema);
  return {
    init: async () => undefined,
    get: async <T>(sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as T | undefined) ?? undefined,
    all: async <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[],
    run: async (sql: string, ...p: unknown[]) => ({ changes: Number(db.prepare(sql).run(...p).changes) }),
  };
}
