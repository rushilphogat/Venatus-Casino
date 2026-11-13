import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';

// SQLite remains available for offline development. Hosted deployments use PostgreSQL.
// All mutations use the same transaction lock across processes (including deploy overlap).
const LOCK = 861943201;
const initialSettings = { bluff: true, chromatic: true, startingChips: 10000, maintenance: false, announcement: '' };
export function postgresSQL(sql) {
  let index = 0;
  return sql.replace(/'(?:(?:'')|[^'])*'|\?/g, token => token === '?' ? `$${++index}` : token)
    .replace(/json_extract\(data,'\$\.status'\)/g, "(data::jsonb->>'status')")
    .replace(/WHERE name=\$1/g, 'WHERE lower(name)=lower($1)');
}
function normalize(row) {
  // PostgreSQL returns BIGINT/COUNT/SUM as strings; our chip bounds fit safe integers.
  const numeric = new Set(['created','at','expires','available','reserved','delta','reserved_delta','startingChips','starts_at','ends_at','participant_limit','n','balance','total']);
  return Object.fromEntries(Object.entries(row).map(([k,v]) => [k,numeric.has(k) && v !== null ? Number(v) : v]));
}
export async function openStorage({ dbPath = ':memory:', databaseUrl, pool: suppliedPool } = {}) {
  const context = new AsyncLocalStorage();
  let queue = Promise.resolve();
  const exclusive = fn => {
    const next = queue.then(fn,fn); queue = next.catch(() => {}); return next;
  };
  let db, pool;
  if (databaseUrl || suppliedPool) {
    pool = suppliedPool || new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000 });
    pool.on?.('error', () => console.error('Database connection interrupted; subsequent requests will reconnect.'));
  } else {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec(readFileSync(new URL('./schema-sqlite.sql', import.meta.url), 'utf8'));
  }
  async function query(sql, args, method) {
    const client = context.getStore();
    if (pool) {
      const result = await (client || pool).query(postgresSQL(sql),args);
      const rows = result.rows.map(normalize);
      return method === 'get' ? rows[0] : method === 'all' ? rows : { changes: result.rowCount };
    }
    const operation = () => db.prepare(sql)[method](...args);
    return client ? operation() : exclusive(operation);
  }
  const get = (sql,...args) => query(sql,args,'get');
  const all = (sql,...args) => query(sql,args,'all');
  const run = (sql,...args) => query(sql,args,'run');
  async function tx(fn) {
    if (context.getStore()) return fn();
    return exclusive(async () => {
      const client = pool ? await pool.connect() : db;
      try {
        if (pool) { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock($1)',[LOCK]); }
        else db.exec('BEGIN IMMEDIATE');
        const result = await context.run(client,fn);
        if (pool) await client.query('COMMIT'); else db.exec('COMMIT');
        return result;
      } catch (error) {
        try { if (pool) await client.query('ROLLBACK'); else db.exec('ROLLBACK'); } catch { /* preserve original failure */ }
        throw error;
      } finally { if (pool) client.release(); }
    });
  }
  try {
    await tx(async () => {
      if (pool) await context.getStore().query(readFileSync(new URL('./schema-postgres.sql',import.meta.url),'utf8'));
      await run('INSERT INTO migrations VALUES(1,?) ON CONFLICT(version) DO NOTHING',Date.now());
      await run('INSERT INTO migrations VALUES(2,?) ON CONFLICT(version) DO NOTHING',Date.now());
      await run('INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO NOTHING',JSON.stringify(initialSettings));
    });
  } catch (error) { if(pool) await pool.end(); else db.close(); throw error; }
  return { db, get, all, run, tx, kind: pool ? 'postgres' : 'sqlite',
    async close() { await queue; if (pool) await pool.end(); else db.close(); } };
}
