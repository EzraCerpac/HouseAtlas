import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files=['app.mjs','model.mjs','render.mjs','copy.mjs','prepare.mjs'];
for(const file of files) {
  const check=spawnSync(process.execPath,['--check',new URL('../src/'+file,import.meta.url).pathname],{encoding:'utf8'});
  if(check.status!==0) throw new Error(check.stderr);
}
const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
if(css.includes('url(')||css.includes('@import')) throw new Error('UI stylesheet must remain bundled without remote assets');
const output=new URL('../dist/',import.meta.url);mkdirSync(output,{recursive:true});
for(const name of [...files.filter(f=>f!=='prepare.mjs'),'styles.css']) copyFileSync(new URL('../src/'+name,import.meta.url),new URL(name,output));
console.log('AT-10 build: 4 browser modules + bundled CSS; server-only prepare export kept separate');
