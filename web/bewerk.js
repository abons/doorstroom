// Bewerkingen op de kaart. Elke bewerking past de kaart aan en geeft een begrotingsregel terug (of null als er
// niets veranderde). Het simnet wordt daarna door de aanroeper opnieuw gebouwd.
import { lengteVan, dichtstbijOpLijn, knipLijn } from './geo.js';
import { klasseVan, linkSleutel } from './net.js';
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
  if (ctrl === 'rotonde') return maakRotonde(kaart, nodeId);
  const n = kaart.nodes[nodeId];
  if (!n || n.ctrl === ctrl || n.ctrl === 'rand') return null;
  const namen = [...new Set(Object.values(kaart.edges).filter((e) => e.a === nodeId || e.b === nodeId).map(naamVan))].slice(0, 2).join(' / ');
  const r = K.kostRegeling(namen || 'kruising', n.ctrl, ctrl);
  n.ctrl = ctrl;
  return r;
}

// De knopen die samen één kruispunt vormen. Een kruising van twee wegen met gescheiden rijbanen is in OSM vier
// knopen op een paar meter van elkaar; een rotonde op één daarvan gaf vier rotondejes (2026-10-25, user).
const KORT = 25;
export function kruispuntVan(kaart, nodeId) {
  const start = kaart.nodes[nodeId];
  if (!start || start.ctrl === 'rand') return [];
  const leden = new Set([nodeId]), stapel = [nodeId];
  while (stapel.length && leden.size < 8) {
    const k = stapel.pop();
    for (const e of Object.values(kaart.edges)) {
      if (e.a !== k && e.b !== k) continue;
      const ander = e.a === k ? e.b : e.a, n = kaart.nodes[ander];
      if (leden.has(ander) || n.ctrl === 'rand' || e.rotonde || lengteVan(e.pts) > KORT) continue;
      if (Math.hypot(n.x - start.x, n.y - start.y) > 40) continue;
      leden.add(ander); stapel.push(ander);
    }
  }
  return [...leden];
}

const armenVan = (kaart, lid) => Object.values(kaart.edges).filter((e) => lid.has(e.a) !== lid.has(e.b));
export const standaardStroken = (kaart, nodeId) =>
  Math.min(3, Math.max(1, ...armenVan(kaart, new Set(kruispuntVan(kaart, nodeId))).map((e) => Math.max(e.lanesF, e.lanesB))));

// Een rotonde als echte ring rond het hele kruispunt: elke arm wordt op de cirkel geknipt, wat binnen ligt valt weg,
// en de knippunten worden met eenrichtingsbogen tegen de klok in verbonden (rotonde: true, rang 10: wie de ring op
// wil, wijkt). Een rotonde als één knoop liet alle bewegingen elkaar kruisen, dus reed er telkens maar één auto
// (2026-10-25). Met lichten krijgt elke ingang een VRI: ring en ingang om beurten.
// Met lichten minstens 30 m: bij 20 m liep de ring vast, ook met de halfvol-regel in sim.js (2026-10-25).
const STRAAL = { 1: 14, 2: 20, 3: 26 }, LICHTSTRAAL = 30;
export function maakRotonde(kaart, nodeId, { stroken, lichten = false } = {}) {
  const leden = kruispuntVan(kaart, nodeId);
  if (!leden.length) return null;
  const lid = new Set(leden);
  const alle = Object.values(kaart.edges).filter((e) => lid.has(e.a) || lid.has(e.b));
  if (alle.some((e) => e.rotonde)) return null; // ligt al aan een rotonde
  const armen = armenVan(kaart, lid);
  if (armen.length < 3) return null;
  stroken = Math.max(1, Math.min(3, stroken ?? standaardStroken(kaart, nodeId)));
  const c = { x: 0, y: 0 };
  for (const k of leden) { c.x += kaart.nodes[k].x / leden.length; c.y += kaart.nodes[k].y / leden.length; }
  const spreiding = Math.max(...leden.map((k) => Math.hypot(kaart.nodes[k].x - c.x, kaart.nodes[k].y - c.y)));
  const R = Math.max(STRAAL[stroken], spreiding + 10, lichten ? LICHTSTRAAL : 0);

  const namen = [...new Set(armen.map(naamVan))].slice(0, 2).join(' / ') || 'kruising';
  const oud = leden.some((k) => kaart.nodes[k].ctrl === 'vri') ? 'vri' : leden.some((k) => kaart.nodes[k].ctrl === 'rotonde') ? 'rotonde' : 'voorrang';
  const r = K.kostRotonde(namen, oud, stroken, lichten);

  for (const e of alle) if (!armen.includes(e)) verwijderEdge(kaart, e.id);
  const punten = [];
  for (const e of armen) {
    const opA = lid.has(e.a);
    const len = lengteVan(e.pts);
    const s = Math.min(len - 1, opCirkel(opA ? e.pts : [...e.pts].reverse(), c, R));
    const binnenKnoop = opA ? e.a : e.b;
    const naarRing = opA ? e.lanesB > 0 : e.lanesF > 0; // rijdt er verkeer over deze arm de ring op?
    const pid = knipWeg(kaart, e.id, opA ? s : len - s);
    const binnen = Object.values(kaart.edges).find((x) => (x.a === binnenKnoop && x.b === pid) || (x.b === binnenKnoop && x.a === pid));
    if (binnen) verwijderEdge(kaart, binnen.id);
    const p = kaart.nodes[pid];
    p.ctrl = lichten && naarRing ? 'vri' : 'voorrang';
    punten.push({ id: pid, hoek: Math.atan2(-(p.y - c.y), p.x - c.x) });
  }
  for (const k of leden) delete kaart.nodes[k];
  punten.sort((p, q) => p.hoek - q.hoek);
  punten.forEach((p, i) => {
    const q = punten[(i + 1) % punten.length];
    let tot = q.hoek; while (tot <= p.hoek) tot += 2 * Math.PI;
    const stappen = Math.max(2, Math.ceil((tot - p.hoek) / 0.2));
    const pts = [];
    for (let k = 0; k <= stappen; k++) {
      const h = p.hoek + ((tot - p.hoek) * k) / stappen;
      pts.push([c.x + R * Math.cos(h), c.y - R * Math.sin(h)]);
    }
    pts[0] = [kaart.nodes[p.id].x, kaart.nodes[p.id].y]; pts[stappen] = [kaart.nodes[q.id].x, kaart.nodes[q.id].y];
    const id = 'w' + kaart.volgnr++;
    kaart.edges[id] = { id, a: p.id, b: q.id, pts, cls: 'tertiary', naam: 'Rotonde', kmh: stroken > 1 ? 40 : 30, lanesF: stroken, lanesB: 0, rotonde: true, nieuw: true };
  });
  return r;
}

// Afstand langs pts (vanaf het begin) waar de lijn voor het eerst buiten de cirkel (c, R) komt.
function opCirkel(pts, c, R) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], l = Math.hypot(x1 - x0, y1 - y0);
    if (Math.hypot(x1 - c.x, y1 - c.y) >= R) {
      let lo = 0, hi = 1;
      for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (Math.hypot(x0 + (x1 - x0) * m - c.x, y0 + (y1 - y0) * m - c.y) < R) lo = m; else hi = m; }
      return s + l * hi;
    }
    s += l;
  }
  return s;
}

function verwijderEdge(kaart, id) {
  delete kaart.edges[id];
  for (const k of Object.keys(kaart.verboden)) if (k.includes(id + ':')) delete kaart.verboden[k];
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
  if (e.a !== e.b) { zetVerbodenOver(kaart, e, e1, e.a); zetVerbodenOver(kaart, e, e2, e.b); }
  for (const k of Object.keys(kaart.verboden)) if (k.includes(edgeId + ':')) delete kaart.verboden[k];
  return id;
}

// Knoop op het wegvak bij (x, y) zetten, zodat een stuk weg apart te selecteren en weg te halen is. Verandert niets
// aan het verkeer, dus geen begrotingsregel: geeft true (of null als er geen weg is of het vlak bij een eind ligt).
export function zetKnoop(kaart, x, y, r) {
  let be = null, bs = null, bd = r;
  for (const e of Object.values(kaart.edges)) { const p = dichtstbijOpLijn(e.pts, x, y); if (p.d < bd) { bd = p.d; be = e; bs = p; } }
  if (!be || bs.s < 3 || bs.s > lengteVan(be.pts) - 3) return null;
  knipWeg(kaart, be.id, bs.s);
  return true;
}

// Knoop tussen precies twee gelijke wegvakken weghalen: die worden weer één. Geeft true, of null als dat niet kan.
export function haalKnoopWeg(kaart, nodeId) {
  const n = kaart.nodes[nodeId];
  if (!n || n.ctrl !== 'voorrang') return null;
  const aan = Object.values(kaart.edges).filter((e) => e.a === nodeId || e.b === nodeId);
  if (aan.length !== 2 || aan.some((e) => e.a === e.b)) return null;
  const draai = (e) => ({ ...e, a: e.b, b: e.a, pts: [...e.pts].reverse(), lanesF: e.lanesB, lanesB: e.lanesF });
  const e1 = aan[0].b === nodeId ? aan[0] : draai(aan[0]), e2 = aan[1].a === nodeId ? aan[1] : draai(aan[1]);
  if (e1.a === e2.b) return null;
  if (!['cls', 'naam', 'kmh', 'lanesF', 'lanesB', 'rotonde'].every((k) => e1[k] === e2[k])) return null;
  const id = 'w' + kaart.volgnr++;
  const e = { ...e1, id, b: e2.b, pts: [...e1.pts, ...e2.pts.slice(1)] };
  kaart.edges[id] = e;
  zetVerbodenOver(kaart, aan[0], e, e.a); zetVerbodenOver(kaart, aan[1], e, e.b);
  for (const oud of aan) {
    delete kaart.edges[oud.id];
    for (const k of Object.keys(kaart.verboden)) if (k.includes(oud.id + ':')) delete kaart.verboden[k];
  }
  delete kaart.nodes[nodeId];
  return true;
}

// Ligt (x, y) binnen r meter van een weg?
export const opWeg = (kaart, x, y, r) => Object.values(kaart.edges).some((e) => dichtstbijOpLijn(e.pts, x, y).d < r);

// ✂ Knippen: het stuk weg tussen twee aangeklikte punten weghalen. Een punt vlak bij een kruising of knoop pakt die
// knoop, anders wordt de weg daar geknipt. Tussen de twee mag alleen weg liggen (geen kruising). Geeft de
// begrotingsregel, of null (en dan is de kaart onveranderd).
export function knipStuk(kaart, pA, pB, r) {
  const terug = JSON.stringify(kaart), mislukt = () => { Object.assign(kaart, JSON.parse(terug)); return null; };
  const a = knoopBij(kaart, pA[0], pA[1], r), b = a && knoopBij(kaart, pB[0], pB[1], r);
  if (!a || !b || a === b) return mislukt();
  const aan = (id) => Object.values(kaart.edges).filter((e) => e.a === id || e.b === id);
  for (const start of aan(a)) {
    const stuk = [start];
    for (let n = start.a === a ? start.b : start.a, e = start; ;) {
      if (n === b) {
        for (const x of stuk) verwijderEdge(kaart, x.id);
        ruimKnopenOp(kaart);
        return K.kostAfsluiten(naamVan(start));
      }
      const verder = aan(n).filter((x) => x !== e);
      if (verder.length !== 1 || kaart.nodes[n].ctrl !== 'voorrang' || stuk.length > 50) break;
      e = verder[0]; stuk.push(e); n = e.a === n ? e.b : e.a;
    }
  }
  return mislukt();
}

// Afslagverboden bij knoop x die over wegvak 'oud' gaan, overzetten op wegvak 'nieuw' (dat ook in x eindigt).
function zetVerbodenOver(kaart, oud, nieuw, x) {
  const inn = (e) => linkSleutel(e.id, e.b === x ? 'f' : 'b'), uit = (e) => linkSleutel(e.id, e.a === x ? 'f' : 'b');
  for (const k of Object.keys(kaart.verboden)) {
    const [i, u] = k.split('>');
    if (i !== inn(oud) && u !== uit(oud)) continue;
    kaart.verboden[`${i === inn(oud) ? inn(nieuw) : i}>${u === uit(oud) ? uit(nieuw) : u}`] = true;
    delete kaart.verboden[k];
  }
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
