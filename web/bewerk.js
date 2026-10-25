// Bewerkingen op de kaart. Elke bewerking past de kaart aan en geeft een begrotingsregel terug (of null als er
// niets veranderde). Het simnet wordt daarna door de aanroeper opnieuw gebouwd.
import { lengteVan, dichtstbijOpLijn, knipLijn } from './geo.js';
import { klasseVan } from './net.js';
import * as K from './kosten.js';

const naamVan = (e) => e.naam || klasseVan(e.cls).naam.toLowerCase();

export function zetSnelheid(kaart, edgeId, kmh) {
  const e = kaart.edges[edgeId];
  if (!e || e.kmh === kmh) return null;
  const r = K.kostSnelheid(naamVan(e), lengteVan(e.pts), (e.lanesF ? 1 : 0) + (e.lanesB ? 1 : 0), e.kmh, kmh);
  e.kmh = kmh;
  return r;
}

export function zetStroken(kaart, edgeId, lanesF, lanesB) {
  const e = kaart.edges[edgeId];
  lanesF = Math.max(0, Math.min(4, lanesF)); lanesB = Math.max(0, Math.min(4, lanesB));
  if (!e || (lanesF === e.lanesF && lanesB === e.lanesB) || lanesF + lanesB === 0) return null;
  const oud = e.lanesF + e.lanesB, nieuw = lanesF + lanesB;
  const richtingOud = richting(e);
  e.lanesF = lanesF; e.lanesB = lanesB;
  if (oud === nieuw) return K.kostRichting(naamVan(e), RICHTING_TEKST[richting(e)] ?? 'stroken anders verdeeld');
  const r = K.kostStroken(naamVan(e), lengteVan(e.pts), oud, nieuw);
  if (richtingOud !== richting(e)) r.omschrijving += `, ${RICHTING_TEKST[richting(e)]}`;
  return r;
}

export const richting = (e) => (e.lanesF && e.lanesB ? 'beide' : e.lanesF ? 'heen' : 'terug');
const RICHTING_TEKST = { beide: 'weer tweerichtingsverkeer', heen: 'eenrichtingsverkeer', terug: 'eenrichtingsverkeer (andere kant op)' };

export function zetRichting(kaart, edgeId, wat) {
  const e = kaart.edges[edgeId];
  if (!e || richting(e) === wat) return null;
  const tot = Math.max(1, e.lanesF + e.lanesB);
  const [f, b] = wat === 'beide' ? [Math.max(1, Math.floor(tot / 2)), Math.max(1, Math.ceil(tot / 2))] : wat === 'heen' ? [tot, 0] : [0, tot];
  e.lanesF = f; e.lanesB = b;
  return K.kostRichting(naamVan(e), RICHTING_TEKST[wat]);
}

export function verwijderWeg(kaart, edgeId) {
  const e = kaart.edges[edgeId];
  if (!e) return null;
  delete kaart.edges[edgeId];
  for (const k of Object.keys(kaart.verboden)) if (k.includes(edgeId + ':')) delete kaart.verboden[k];
  ruimKnopenOp(kaart);
  return K.kostAfsluiten(naamVan(e));
}

export function zetRegeling(kaart, nodeId, ctrl) {
  const n = kaart.nodes[nodeId];
  if (!n || n.ctrl === ctrl || n.ctrl === 'rand') return null;
  const armen = Object.values(kaart.edges).filter((e) => e.a === nodeId || e.b === nodeId);
  if (ctrl === 'rotonde' && armen.some((e) => e.rotonde)) return null; // ligt al aan een rotonde
  const namen = [...new Set(armen.map(naamVan))].slice(0, 2).join(' / ');
  const r = K.kostRegeling(namen || 'kruising', n.ctrl, ctrl);
  if (ctrl === 'rotonde' && maakRing(kaart, nodeId)) return r;
  n.ctrl = ctrl;
  return r;
}

// Een rotonde als echte ring: elke arm wordt R meter van het midden geknipt, het stuk binnen de cirkel valt weg en
// de knippunten worden met eenrichtingsbogen tegen de klok in verbonden. Een rotonde als één knoop liet alle
// bewegingen elkaar kruisen, dus reed er telkens maar één auto: niet beter dan een voorrangskruising (2026-10-25).
// De ringwegen krijgen rotonde: true (rang 10), dus wie de ring op wil, wijkt.
const RING = 14;
function maakRing(kaart, nodeId) {
  const c = kaart.nodes[nodeId];
  const armen = Object.values(kaart.edges).filter((e) => (e.a === nodeId) !== (e.b === nodeId));
  if (armen.length < 3) return false;
  const R = Math.max(6, Math.min(RING, ...armen.map((e) => 0.6 * lengteVan(e.pts))));
  const punten = [];
  for (const e of armen) {
    const len = lengteVan(e.pts), opA = e.a === nodeId;
    const pid = knipWeg(kaart, e.id, opA ? R : len - R);
    const binnen = Object.values(kaart.edges).find((x) => (x.a === nodeId && x.b === pid) || (x.b === nodeId && x.a === pid));
    if (binnen) delete kaart.edges[binnen.id];
    const p = kaart.nodes[pid];
    punten.push({ id: pid, hoek: Math.atan2(-(p.y - c.y), p.x - c.x) });
  }
  punten.sort((p, q) => p.hoek - q.hoek);
  punten.forEach((p, i) => {
    const q = punten[(i + 1) % punten.length];
    let tot = q.hoek; while (tot <= p.hoek) tot += 2 * Math.PI;
    const stappen = Math.max(2, Math.ceil((tot - p.hoek) / 0.26));
    const pts = [];
    for (let k = 0; k <= stappen; k++) {
      const h = p.hoek + ((tot - p.hoek) * k) / stappen;
      pts.push([c.x + R * Math.cos(h), c.y - R * Math.sin(h)]);
    }
    pts[0] = [kaart.nodes[p.id].x, kaart.nodes[p.id].y]; pts[stappen] = [kaart.nodes[q.id].x, kaart.nodes[q.id].y];
    const id = 'w' + kaart.volgnr++;
    kaart.edges[id] = { id, a: p.id, b: q.id, pts, cls: 'tertiary', naam: 'Rotonde', kmh: 30, lanesF: 1, lanesB: 0, rotonde: true, nieuw: true };
  });
  delete kaart.nodes[nodeId];
  return true;
}

export function wisselVerbod(kaart, sleutel, omschrijving) {
  const aan = !!kaart.verboden[sleutel];
  if (aan) delete kaart.verboden[sleutel]; else kaart.verboden[sleutel] = true;
  return K.kostAfslag(omschrijving, aan);
}

// Knoop zoeken binnen r meter, anders een wegvak binnen r meter knippen. Geeft een knoop-id of null.
export function knoopBij(kaart, x, y, r) {
  let best = null, bd = r;
  for (const n of Object.values(kaart.nodes)) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n.id; } }
  if (best) return best;
  let be = null, bs = null;
  bd = r;
  for (const e of Object.values(kaart.edges)) { const p = dichtstbijOpLijn(e.pts, x, y); if (p.d < bd) { bd = p.d; be = e; bs = p; } }
  if (!be) return null;
  return knipWeg(kaart, be.id, bs.s);
}

// Knipt wegvak edgeId op s meter vanaf a; geeft de nieuwe knoop-id.
export function knipWeg(kaart, edgeId, s) {
  const e = kaart.edges[edgeId];
  const len = lengteVan(e.pts);
  s = Math.max(1, Math.min(len - 1, s));
  const [p1, p2] = knipLijn(e.pts, s);
  const id = 'n' + kaart.volgnr++;
  const [x, y] = p1[p1.length - 1];
  kaart.nodes[id] = { id, x, y, ctrl: 'voorrang' };
  const e1 = { ...e, id: 'w' + kaart.volgnr++, b: id, pts: p1 };
  const e2 = { ...e, id: 'w' + kaart.volgnr++, a: id, pts: p2 };
  delete kaart.edges[edgeId];
  kaart.edges[e1.id] = e1; kaart.edges[e2.id] = e2;
  for (const k of Object.keys(kaart.verboden)) if (k.includes(edgeId + ':')) delete kaart.verboden[k];
  return id;
}

// Nieuwe weg langs punten [[x,y],...]. Begin en eind haken aan een knoop of weg binnen 'vang' meter.
export function tekenWeg(kaart, punten, { cls = 'tertiary', kmh = 50, stroken = 1, vang = 12 } = {}) {
  if (punten.length < 2) return null;
  const lengte = lengteVan(punten);
  if (lengte < 10) return null;
  const eind = (p) => {
    const id = knoopBij(kaart, p[0], p[1], vang);
    if (id) return id;
    const nid = 'n' + kaart.volgnr++;
    kaart.nodes[nid] = { id: nid, x: p[0], y: p[1], ctrl: 'voorrang' };
    return nid;
  };
  const a = eind(punten[0]), b = eind(punten[punten.length - 1]);
  if (a === b) return null;
  const pts = [[kaart.nodes[a].x, kaart.nodes[a].y], ...punten.slice(1, -1), [kaart.nodes[b].x, kaart.nodes[b].y]];
  const id = 'w' + kaart.volgnr++;
  kaart.edges[id] = { id, a, b, pts, cls, naam: 'Nieuwe weg', kmh, lanesF: stroken, lanesB: stroken, rotonde: false, nieuw: true };
  return K.kostNieuweWeg(lengte, 2 * stroken);
}

function ruimKnopenOp(kaart) {
  const gebruikt = new Set();
  for (const e of Object.values(kaart.edges)) { gebruikt.add(e.a); gebruikt.add(e.b); }
  for (const id of Object.keys(kaart.nodes)) if (!gebruikt.has(id)) delete kaart.nodes[id];
}
