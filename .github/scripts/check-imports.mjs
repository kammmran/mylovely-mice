/**
 * Every relative import in src/ has to point at a file that exists.
 *
 * This is the failure the browser reports as a blank page and a console error
 * nobody sees, and it is the one a rename causes. Bare specifiers (`three`)
 * are resolved by the import map in index.html, so they are skipped here.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : join(dir, e.name));

const files = walk('src').filter((f) => f.endsWith('.js'));
let bad = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const target = resolve(dirname(file), spec);
    if (!existsSync(target)) {
      console.error(`missing: ${file} imports ${spec}`);
      bad++;
    }
  }
}
console.log(`${files.length} modules checked`);
if (bad) process.exit(1);
