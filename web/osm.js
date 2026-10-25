// Ophalen: wegennet uit OpenStreetMap (Overpass) en adressen zoeken (PDOK Locatieserver). Overpass-antwoorden
// gaan in de Cache API, dus een gebied dat je al eens laadde komt daarna direct en ook offline.
import { overpassQuery } from './net.js';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const CACHE = 'doorstroom-osm';

export async function haalWegen(bbox, melding = () => {}) {
  const q = overpassQuery(bbox.map((v) => +v.toFixed(5)));
  const sleutel = 'https://cache.doorstroom/osm?q=' + encodeURIComponent(q);
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(sleutel); if (hit) return await hit.json(); } catch {}
  let fout;
  for (const url of OVERPASS) {
    const t0 = Date.now();
    const tik = setInterval(() => melding(`Wegen ophalen bij ${new URL(url).host}… ${Math.round((Date.now() - t0) / 1000)} s (OpenStreetMap is soms traag)`), 1000);
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 130000);
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal: ctl.signal });
      if (!r.ok) throw new Error(`${r.status}`);
      const tekst = await r.text();
      clearTimeout(timer);
      const json = JSON.parse(tekst);
      try { await cache?.put(sleutel, new Response(tekst, { headers: { 'content-type': 'application/json' } })); } catch {}
      return json;
    } catch (e) { fout = e; } finally { clearInterval(tik); }
  }
  throw new Error(`Overpass niet bereikbaar (${fout?.message ?? fout})`);
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
