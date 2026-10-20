/**
 * Every import in src/ and vendor/ has to point at a file that exists.
 *
 * This is the failure the browser reports as a blank page and a console error
 * nobody sees, and it is the one a rename causes. Resolve bare specifiers
 * through the page's import map too, including vendored addon dependencies.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : join(dir, e.name));

const html = readFileSync('index.html', 'utf8');
const imports = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
const files = [...walk('src'), ...walk('vendor')].filter((f) => f.endsWith('.js'));
let bad = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
    const spec = m[1];
    const prefix = Object.keys(imports).find((key) => key.endsWith('/') && spec.startsWith(key));
    const mapped = imports[spec] || (prefix && imports[prefix] + spec.slice(prefix.length));
    const target = spec.startsWith('.') ? resolve(dirname(file), spec) : mapped && resolve(mapped);
    if (!target || !existsSync(target)) {
      console.error(`missing: ${file} imports ${spec}`);
      bad++;
    }
  }
}
console.log(`${files.length} modules checked`);
if (bad) process.exit(1);
