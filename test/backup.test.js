import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBackup} from '../src/backup.js';

test('backup captures committed WAL state, passes integrity and refuses overwrite',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'venatus-backup-')),source=join(dir,'live.sqlite'),target=join(dir,'snapshot.sqlite');
  const db=new DatabaseSync(source);
  try {
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE sample(value INTEGER); INSERT INTO sample VALUES(42)');
    createBackup(source,target);
    db.exec('INSERT INTO sample VALUES(99)');
    const copy=new DatabaseSync(target,{readOnly:true});
    try {assert.deepEqual(copy.prepare('SELECT value FROM sample').all().map(x=>x.value),[42]);}finally{copy.close();}
    assert.throws(()=>createBackup(source,target),/never overwritten/);
    assert.throws(()=>createBackup(join(dir,'missing.sqlite'),join(dir,'new.sqlite')),/does not exist/);
  }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
