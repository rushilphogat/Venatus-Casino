import { PGlite } from '@electric-sql/pglite';
import { openStorage } from '../src/storage.js';

// Runs PostgreSQL itself in WASM, including schema, triggers and SQL semantics.
// Production uses pg over TLS; transport/network recovery is verified separately.
export async function postgresStorage(directory) {
  const database = new PGlite(directory);
  const client = {
    async query(sql,args) {
      if (args !== undefined || !sql.includes(';')) {
        const r=await database.query(sql,args); return { rows:r.rows, rowCount:r.affectedRows };
      }
      const results=await database.exec(sql); const r=results.at(-1); return { rows:r?.rows||[],rowCount:r?.affectedRows||0 };
    },
    release() {},
  };
  const pool = { ...client, connect:async()=>client, end:()=>database.close() };
  const storage=await openStorage({pool});
  storage.db={prepare:sql=>({ get:(...args)=>storage.get(sql,...args), all:(...args)=>storage.all(sql,...args),run:(...args)=>storage.run(sql,...args) })};
  return storage;
}
