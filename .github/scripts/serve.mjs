/** the smallest static server that can serve ES modules concurrently */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const ROOT = process.cwd();
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml',
};
createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const path = join(ROOT, normalize(url === '/' ? '/index.html' : url));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const buf = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404).end('not found'); }
}).listen(Number(process.env.PORT) || 8777);
