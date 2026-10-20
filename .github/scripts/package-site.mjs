/** Stage only public runtime files for GitHub Pages and its browser checks. */
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const path of ['index.html', '.nojekyll', 'src', 'styles', 'data', 'vendor']) {
  cpSync(path, `dist/${path}`, { recursive: true });
}
console.log('GitHub Pages site staged in dist/');
