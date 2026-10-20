/** the smallest static server that can serve ES modules concurrently */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';

const ROOT = resolve(process.env.SITE_ROOT || '.');
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const PORT = Number(process.env.PORT) || 8777;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml',
};
createServer(async (req, res) => {
  try {
    let url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (url === BASE_PATH) url += '/';
    if (!url.startsWith(`${BASE_PATH}/`)) { res.writeHead(404).end(); return; }
    url = url.slice(BASE_PATH.length);
    const path = resolve(ROOT, `.${url === '/' ? '/index.html' : url}`);
    if (relative(ROOT, path).startsWith('..')) { res.writeHead(403).end(); return; }
    const buf = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404).end('not found'); }
}).listen(PORT, () => console.log(`http://localhost:${PORT}${BASE_PATH}/`));
