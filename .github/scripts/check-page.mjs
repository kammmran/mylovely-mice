/**
 * index.html has to point at files that exist, and the entry module has to be
 * there. The import map must resolve locally, including directory mappings.
 */
import { readFileSync, existsSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
  .filter((u) => !/^(https?:)?\/\//.test(u) && !u.startsWith('data:') && !u.startsWith('#'));

let bad = 0;
for (const ref of new Set(refs)) {
  const path = ref.replace(/^\.\//, '').split(/[?#]/)[0];
  if (!existsSync(path)) { console.error(`missing: index.html references ${ref}`); bad++; }
  else console.log(`ok  ${ref}`);
}
if (!existsSync('src/main.js')) { console.error('missing: src/main.js'); bad++; }
const importMap = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
for (const [name, path] of Object.entries(importMap.imports)) {
  if (!path.startsWith('./') || !existsSync(path)) {
    console.error(`missing or external import map target: ${name} -> ${path}`);
    bad++;
  }
}
if (bad) process.exit(1);
