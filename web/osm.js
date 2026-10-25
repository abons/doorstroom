// Ophalen: wegennet uit OpenStreetMap (wegtegels, eigen server of Overpass) en adressen zoeken (PDOK Locatieserver). Antwoorden
// gaan in de Cache API, dus een gebied dat je al eens laadde komt daarna direct en ook offline.
import { overpassQuery } from './net.js';
import { tegelsVoor, tegelUrl, naarOverpass } from './tegels.js';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const CACHE = 'doorstroom-osm';

export async function haalWegen(bbox, melding = () => {}) {
  const b5 = bbox.map((v) => +v.toFixed(5));
  const q = overpassQuery(b5);
  const sleutel = 'https://cache.doorstroom/osm?q=' + encodeURIComponent(q);
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(sleutel); if (hit) return await hit.json(); } catch {}
  const t0 = Date.now();
  let waar = 'de wegtegels';
  const tik = setInterval(() => melding(`Wegen ophalen bij ${waar}… ${Math.round((Date.now() - t0) / 1000)} s`), 1000);
  try {
    // Eerst de wegtegels (abons/doorstroom-wegen, ~0,3 s), dan de eigen server (serve.mjs → OSM-API), dan Overpass.
    let tekst;
    try { tekst = JSON.stringify(await uitTegels(b5)); } catch {
      waar = 'de server';
      try { tekst = await haal('osm?bbox=' + b5.join(','), null, 60000); } catch {
        waar = 'Overpass (OpenStreetMap, kan een minuut duren)';
        tekst = await overpass(q);
      }
    }
    const json = JSON.parse(tekst);
    try { await cache?.put(sleutel, new Response(tekst, { headers: { 'content-type': 'application/json' } })); } catch {}
    return json;
  } finally { clearInterval(tik); }
}

// Een tegel zonder autowegen bestaat niet (404): die is leeg.
async function uitTegels(bbox) {
  const lijst = tegelsVoor(bbox);
  if (lijst.length > 30) throw new Error('te veel tegels');
  const json = await Promise.all(lijst.map(async ([x, y]) => {
    const r = await fetch(tegelUrl(x, y));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`tegel ${r.status}`);
    return r.json();
  }));
  return naarOverpass(json.filter(Boolean));
}

async function haal(url, body, ms, stop) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  stop?.addEventListener('abort', () => ctl.abort());
  try {
    const r = await fetch(url, body ? { method: 'POST', body, signal: ctl.signal } : { signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}

// Alle Overpass-servers tegelijk: de eerste met een antwoord wint, de rest wordt afgebroken.
async function overpass(q) {
  const stop = new AbortController();
  try {
    return await Promise.any(OVERPASS.map((url) => haal(url, new URLSearchParams({ data: q }), 130000, stop.signal)));
  } catch (e) {
    throw new Error(`Overpass niet bereikbaar (${e.errors?.map((x) => x.message).join(', ') ?? e.message})`);
  } finally { stop.abort(); }
}

// Vast stuk Amersfoort (binnenstad + Stadsring), voor als Overpass niet wil of om snel te proberen.
export const DEMO = { url: 'demo/amersfoort.json', bbox: [52.150, 5.380, 52.160, 5.395] };

export async function zoekAdres(tekst) {
  const url = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${encodeURIComponent(tekst)}&rows=6&fl=weergavenaam,centroide_ll,type&fq=type:(gemeente OR woonplaats OR weg OR adres OR postcode)`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Locatieserver ${r.status}`);
  const j = await r.json();
  return j.response.docs.map((d) => {
    const m = /POINT\(([\d.]+) ([\d.]+)\)/.exec(d.centroide_ll);
    return { naam: d.weergavenaam, type: d.type, lon: +m[1], lat: +m[2] };
  });
}

export const TEGELS = {
  kaart: { url: (z, x, y) => `https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857/${z}/${x}/${y}.png`, max: 19, bron: 'Kaart: PDOK BRT-Achtergrondkaart (CC BY 4.0, Kadaster)' },
  luchtfoto: { url: (z, x, y) => `https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/${z}/${x}/${y}.jpeg`, max: 20, bron: 'Luchtfoto: PDOK/Beeldmateriaal Nederland (CC BY 4.0)' },
};
