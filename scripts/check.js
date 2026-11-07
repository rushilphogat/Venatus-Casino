import {readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let count=0;
for(const folder of ['src','public','scripts','test'])for(const file of readdirSync(resolve(root,folder)).filter(f=>f.endsWith('.js'))){
  const result=spawnSync(process.execPath,['--check',resolve(root,folder,file)],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);count++;
}
console.log(`Syntax checked ${count} JavaScript files.`);
