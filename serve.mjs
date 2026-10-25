// Serveert web/ op 127.0.0.1:8095 en heeft één eigen route: /osm?bbox=z,w,n,o. Die haalt het wegennet bij de
// OSM-API (seconden) in plaats van bij Overpass (2026-10-25: 30-40 s, zelfs voor een lege query), filtert het tot
// wegen voor auto's, en bewaart het in cache/. Zonder deze server valt de app terug op Overpass.
// Gebruik: node serve.mjs
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HIGHWAYS } from './web/net.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HIER, 'web'), CACHE = join(HIER, 'cache');
const PORT = Number(process.env.PORT) || 8095;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const UA = 'doorstroom/0.1 (traffic game, local use)';

// De OSM-API geeft alles (ook gebouwen) en weigert boven 50.000 knopen; dus in tegels van hoogstens 0,01°, en een
// tegel die te vol is in vieren.
async function tegel([s, w, n, e], diepte = 0) {
  const r = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${w},${s},${e},${n}`, { headers: { 'User-Agent': UA } });
  if (r.status === 400 && diepte < 3) {
    const ms = (s + n) / 2, mw = (w + e) / 2;
    const delen = await Promise.all([[s, w, ms, mw], [s, mw, ms, e], [ms, w, n, mw], [ms, mw, n, e]].map((b) => tegel(b, diepte + 1)));
    return delen.flat();
  }
  if (!r.ok) throw new Error(`OSM-API ${r.status}`);
  return (await r.json()).elements;
}

async function wegen(bbox) {
  const [s, w, n, e] = bbox, STAP = 0.01;
  const ny = Math.ceil((n - s) / STAP), nx = Math.ceil((e - w) / STAP), tegels = [];
  for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++)
    tegels.push([s + i * (n - s) / ny, w + j * (e - w) / nx, s + (i + 1) * (n - s) / ny, w + (j + 1) * (e - w) / nx]);
  const alles = [];
  for (let k = 0; k < tegels.length; k += 3) alles.push(...(await Promise.all(tegels.slice(k, k + 3).map((t) => tegel(t)))).flat());
  const ways = new Map(), nodes = new Map();
  for (const el of alles) {
    if (el.type === 'way' && HIGHWAYS.includes(el.tags?.highway)) ways.set(el.id, el);
    else if (el.type === 'node') nodes.set(el.id, el);
  }
  const nodig = new Set([...ways.values()].flatMap((wy) => wy.nodes));
  const uit = [];
  for (const k of nodes.values()) {
    if (!nodig.has(k.id) && k.tags?.highway !== 'traffic_signals') continue;
    const tags = k.tags?.highway ? { highway: k.tags.highway, ...(k.tags.crossing && { crossing: k.tags.crossing }) } : undefined;
    uit.push({ type: 'node', id: k.id, lat: k.lat, lon: k.lon, ...(tags && { tags }) });
  }
  for (const wy of ways.values()) uit.push({ type: 'way', id: wy.id, nodes: wy.nodes, tags: wy.tags });
  return { elements: uit };
}

async function osm(url, res) {
  const bbox = (url.searchParams.get('bbox') ?? '').split(',').map(Number);
  const [s, w, n, e] = bbox;
  if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v)) || n <= s || e <= w || n - s > 0.05 || e - w > 0.05) {
    res.writeHead(400).end('bbox: zuid,west,noord,oost, hoogstens 0,05°'); return;
  }
  const bestand = join(CACHE, `osm-${bbox.map((v) => v.toFixed(5)).join('_')}.json`);
  let tekst;
  try { tekst = readFileSync(bestand, 'utf8'); } catch {
    const t0 = Date.now();
    tekst = JSON.stringify(await wegen(bbox));
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(bestand, tekst);
    console.log(`osm ${bbox} ${tekst.length} B in ${Date.now() - t0} ms`);
  }
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(tekst);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/osm') return await osm(url, res);
    const pad = decodeURIComponent(url.pathname);
    const naam = normalize(pad === '/' ? 'index.html' : pad.slice(1));
    if (naam.startsWith('..') || naam.includes(':')) throw new Error('buiten web/');
    const inhoud = readFileSync(join(ROOT, naam));
    res.writeHead(200, { 'content-type': TYPES[extname(naam)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(inhoud);
  } catch (e) {
    if (!res.headersSent) res.writeHead(e.message?.startsWith('OSM-API') ? 502 : 404).end(e.message?.startsWith('OSM-API') ? e.message : 'Niet gevonden');
  }
}).on('error', (e) => { console.error('listen', e.message); process.exit(1); })
  .listen(PORT, '127.0.0.1', () => console.log(`http://127.0.0.1:${PORT}`));
