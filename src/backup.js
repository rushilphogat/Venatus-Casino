import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// VACUUM INTO takes a consistent SQLite snapshot, including committed WAL data.
// It refuses to replace an existing backup and does not modify the live database.
export function createBackup(source, destination) {
  source=resolve(source); destination=resolve(destination);
  if(!existsSync(source))throw new Error('Source database does not exist');
  if(source===destination||existsSync(destination))throw new Error('Choose a new backup file; existing files are never overwritten');
  mkdirSync(dirname(destination),{recursive:true});
  const db=new DatabaseSync(source,{readOnly:true});
  try {db.exec('PRAGMA busy_timeout=5000'); db.exec(`VACUUM INTO '${destination.replaceAll("'","''")}'`);} finally {db.close();}
  const copy=new DatabaseSync(destination,{readOnly:true});
  try {if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup integrity check failed');} finally {copy.close();}
  return destination;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const data=process.env.DATA_DIR||resolve(root,'data');
  const target=process.argv[2]||resolve(data,'backups',`casino-${new Date().toISOString().replaceAll(':','-')}.sqlite`);
  try{console.log('Verified backup:',createBackup(resolve(data,'casino.sqlite'),target));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
