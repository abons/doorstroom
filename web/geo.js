// Projectie: lokaal vlak in meters rond een oorsprong (x oost, y zuid, zoals het scherm). Over een paar km is
// dit equirectangulair genoeg; kaarttegels worden per tegel op hun eigen hoeken geplaatst, dus die sluiten altijd aan.
export const R = 6378137;
const RAD = Math.PI / 180;

export function maakProjectie(lat0, lon0) {
  const k = Math.cos(lat0 * RAD) * R * RAD;
  const ky = R * RAD;
  return {
    lat0, lon0,
    naarXY: (lat, lon) => [(lon - lon0) * k, -(lat - lat0) * ky],
    naarLL: (x, y) => [lat0 - y / ky, lon0 + x / k],
  };
}

// Web-mercator tegelnummers (PDOK WMTS EPSG:3857 gebruikt dezelfde z/x/y als OSM).
export const lon2tile = (lon, z) => ((lon + 180) / 360) * 2 ** z;
export const lat2tile = (lat, z) => ((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2) * 2 ** z;
export const tile2lon = (x, z) => (x / 2 ** z) * 360 - 180;
export const tile2lat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) / RAD;

// Meters per pixel van tegelniveau z (256 px-tegels) op breedtegraad lat.
export const mppOpZ = (z, lat) => (156543.03392 * Math.cos(lat * RAD)) / 2 ** z;

export const afstand = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

// Dichtstbijzijnde punt op een polylijn: { d (afstand), s (meters vanaf het begin), x, y }.
export function dichtstbijOpLijn(pts, px, py) {
  let best = { d: Infinity, s: 0, x: 0, y: 0 };
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, l = Math.sqrt(l2);
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    const x = ax + t * dx, y = ay + t * dy, d = Math.hypot(px - x, py - y);
    if (d < best.d) best = { d, s: s + t * l, x, y };
    s += l;
  }
  return best;
}

export function lengteVan(pts) {
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return s;
}

// Cumulatieve lengtes, voor snel een punt op afstand s vinden.
export function cumulatief(pts) {
  const c = [0];
  for (let i = 0; i + 1 < pts.length; i++) c.push(c[i] + Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
  return c;
}

// Punt en richting (radialen, schermhoek) op afstand s langs pts met cumulatieve lengtes cum. Zoekt binair.
export function puntOp(pts, cum, s, uit = [0, 0, 0]) {
  const n = pts.length;
  if (s <= 0) s = 0;
  if (s >= cum[n - 1]) s = cum[n - 1];
  let lo = 0, hi = n - 2;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
  const [ax, ay] = pts[lo], [bx, by] = pts[lo + 1];
  const l = cum[lo + 1] - cum[lo] || 1, t = (s - cum[lo]) / l;
  uit[0] = ax + (bx - ax) * t; uit[1] = ay + (by - ay) * t; uit[2] = Math.atan2(by - ay, bx - ax);
  return uit;
}

// Polylijn opknippen op afstand s (meters vanaf het begin): [deelA, deelB], het knippunt zit in beide.
export function knipLijn(pts, s) {
  const cum = cumulatief(pts);
  const p = puntOp(pts, cum, s);
  let i = 0;
  while (i + 1 < pts.length - 1 && cum[i + 1] < s) i++;
  const knip = [p[0], p[1]];
  return [[...pts.slice(0, i + 1), knip], [knip, ...pts.slice(i + 1)]];
}
