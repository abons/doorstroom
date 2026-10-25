// Serveert web/ op 127.0.0.1:8095 voor lokaal ontwikkelen. De app zelf heeft geen server nodig (alles statisch).
// Gebruik: node serve.mjs
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'web');
const PORT = Number(process.env.PORT) || 8095;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

createServer((req, res) => {
  try {
    const pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const naam = normalize(pad === '/' ? 'index.html' : pad.slice(1));
    if (naam.startsWith('..') || naam.includes(':')) throw new Error('buiten web/');
    const inhoud = readFileSync(join(ROOT, naam));
    res.writeHead(200, { 'content-type': TYPES[extname(naam)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(inhoud);
  } catch {
    res.writeHead(404).end('Niet gevonden');
  }
}).on('error', (e) => { console.error('listen', e.message); process.exit(1); })
  .listen(PORT, '127.0.0.1', () => console.log(`http://127.0.0.1:${PORT}`));
