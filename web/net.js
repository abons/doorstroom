// Het wegennet in twee vormen:
//  - de *kaart*: wat de speler bewerkt en wat wordt opgeslagen (knopen, wegvakken met rijstroken/snelheid, verboden
//    afslagen). Gewone objecten, dus structuredClone/JSON werken (ongedaan maken, opslaan).
//  - het *simnet*: afgeleid uit de kaart, gerichte links met afslagbewegingen, conflicten en voorrang. Wordt na
//    elke bewerking opnieuw gebouwd.
import { maakProjectie, lengteVan, cumulatief, dichtstbijOpLijn } from './geo.js';

export const KLASSEN = {
  motorway: { rang: 9, kmh: 100, strook: 2, naam: 'Snelweg' },
  trunk: { rang: 8, kmh: 80, strook: 2, naam: 'Autoweg' },
  primary: { rang: 7, kmh: 50, strook: 1, naam: 'Hoofdweg' },
  secondary: { rang: 6, kmh: 50, strook: 1, naam: 'Gebiedsontsluitingsweg' },
  tertiary: { rang: 5, kmh: 50, strook: 1, naam: 'Wijkweg' },
  unclassified: { rang: 3, kmh: 50, strook: 1, naam: 'Overige weg' },
  residential: { rang: 2, kmh: 30, strook: 1, naam: 'Woonstraat' },
  living_street: { rang: 1, kmh: 15, strook: 1, naam: 'Woonerf' },
};
const basisKlasse = (cls) => cls.replace(/_link$/, '');
export const klasseVan = (cls) => KLASSEN[basisKlasse(cls)] ?? KLASSEN.unclassified;
export const HIGHWAYS = [...Object.keys(KLASSEN), 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'];

// Overpass-query voor een bbox [zuid, west, noord, oost].
export function overpassQuery([s, w, n, e]) {
  return `[out:json][timeout:120];way["highway"~"^(${HIGHWAYS.join('|')})$"](${s},${w},${n},${e});(._;>;);out body;`;
}

function parseSnelheid(v, cls) {
  if (v) {
    const m = /^(\d+)/.exec(v);
    if (m) return /mph/.test(v) ? Math.round(+m[1] * 1.609) : +m[1];
    if (/urban/.test(v)) return 50;
    if (/rural/.test(v)) return 80;
    if (/zone30|zone:30/.test(v)) return 30;
    if (/living_street|walk/.test(v)) return 15;
    if (/motorway/.test(v)) return 100;
  }
  return klasseVan(cls).kmh;
}

const geenAuto = (t) => ['no', 'private', 'agricultural', 'forestry', 'delivery'].includes(t.motor_vehicle ?? t.motorcar ?? t.vehicle ?? t.access ?? '')
  || t.area === 'yes' || t.highway === 'construction';

// OSM (Overpass JSON) -> kaart. bbox in graden [zuid, west, noord, oost]. Wegen lopen één knoop buiten de bbox door;
// die knopen worden 'rand': daar komt verkeer het gebied in en gaat het eruit.
export function importOsm(osm, bbox) {
  const [s, w, n, e] = bbox;
  const proj = maakProjectie((s + n) / 2, (w + e) / 2);
  const nodesOsm = new Map(), ways = [];
  for (const el of osm.elements) {
    if (el.type === 'node') nodesOsm.set(el.id, el);
    else if (el.type === 'way' && el.tags && HIGHWAYS.includes(el.tags.highway) && !geenAuto(el.tags)) ways.push(el);
  }
  const binnen = (id) => { const k = nodesOsm.get(id); return k && k.lat >= s && k.lat <= n && k.lon >= w && k.lon <= e; };

  // Per weg de stukken die binnen liggen, met aan elke kant één knoop extra.
  const runs = [];
  for (const way of ways) {
    const ids = way.nodes.filter((id) => nodesOsm.has(id));
    const mee = ids.map((id, i) => binnen(id) || (i > 0 && binnen(ids[i - 1])) || (i + 1 < ids.length && binnen(ids[i + 1])));
    let cur = [];
    ids.forEach((id, i) => {
      if (mee[i]) cur.push(id);
      else { if (cur.length > 1) runs.push({ way, ids: cur }); cur = []; }
    });
    if (cur.length > 1) runs.push({ way, ids: cur });
  }
  const gebruik = new Map();
  for (const r of runs) r.ids.forEach((id, i) => {
    const eind = i === 0 || i === r.ids.length - 1;
    gebruik.set(id, (gebruik.get(id) ?? 0) + (eind ? 1 : 2));
  });
  const isKnoop = (id, i, r) => i === 0 || i === r.ids.length - 1 || gebruik.get(id) > 2;

  const kaart = leegKaart(proj.lat0, proj.lon0, bbox);
  kaart.grens = [...proj.naarXY(n, w), ...proj.naarXY(s, e)];
  const bord = []; // verkeerslichtknopen (vaak op het aanrijvak, niet op de kruising zelf)
  const knoop = (id) => {
    if (!kaart.nodes[id]) {
      const k = nodesOsm.get(id), [x, y] = proj.naarXY(k.lat, k.lon);
      kaart.nodes[id] = { id: String(id), x, y, ctrl: binnen(id) ? 'voorrang' : 'rand' };
    }
    return kaart.nodes[id];
  };
  for (const [id, k] of nodesOsm) {
    if (k.tags?.highway === 'traffic_signals' && !k.tags.crossing && gebruik.has(id)) bord.push(proj.naarXY(k.lat, k.lon));
  }
  let eid = 0;
  for (const r of runs) {
    const t = r.way.tags, cls = t.highway;
    let start = 0;
    for (let i = 1; i < r.ids.length; i++) {
      if (!isKnoop(r.ids[i], i, r)) continue;
      const deel = r.ids.slice(start, i + 1);
      start = i;
      if (deel[0] === deel[deel.length - 1] && deel.length < 3) continue;
      const pts = deel.map((id) => { const k = nodesOsm.get(id); return proj.naarXY(k.lat, k.lon); });
      const a = knoop(deel[0]), b = knoop(deel[deel.length - 1]);
      const rotonde = t.junction === 'roundabout' || t.junction === 'circular';
      let ow = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || rotonde || cls === 'motorway' || cls === 'motorway_link';
      const omgekeerd = t.oneway === '-1';
      if (omgekeerd) { pts.reverse(); ow = true; }
      const kl = klasseVan(cls);
      let lanesF, lanesB;
      const lanes = +t.lanes || 0;
      if (ow) { lanesF = Math.max(1, Math.min(4, lanes || kl.strook)); lanesB = 0; }
      else if (t['lanes:forward'] || t['lanes:backward']) { lanesF = +t['lanes:forward'] || 1; lanesB = +t['lanes:backward'] || 1; }
      else { lanesF = Math.max(1, Math.floor(lanes / 2) || kl.strook); lanesB = Math.max(1, Math.ceil(lanes / 2) || kl.strook); }
      if (!ow && lanes === 1) { lanesF = 1; lanesB = 1; }
      const id = 'e' + eid++;
      kaart.edges[id] = {
        id, a: omgekeerd ? b.id : a.id, b: omgekeerd ? a.id : b.id, pts, cls, naam: t.name ?? t.ref ?? '',
        kmh: parseSnelheid(t.maxspeed, cls), lanesF: Math.min(lanesF, 4), lanesB: Math.min(lanesB, 4), rotonde,
      };
    }
  }
  // Verkeerslichten: een kruising (3+ armen) met een lichtknoop binnen 30 m wordt een VRI.
  const graad = graden(kaart);
  for (const k of Object.values(kaart.nodes)) {
    if (k.ctrl !== 'voorrang' || (graad.get(k.id) ?? 0) < 3) continue;
    if (bord.some(([x, y]) => Math.hypot(x - k.x, y - k.y) < 30)) k.ctrl = 'vri';
  }
  return kaart;
}

export function leegKaart(lat0, lon0, bbox) {
  return { lat0, lon0, bbox, nodes: {}, edges: {}, verboden: {}, volgnr: 1 };
}

function graden(kaart) {
  const g = new Map();
  for (const e of Object.values(kaart.edges)) { g.set(e.a, (g.get(e.a) ?? 0) + 1); g.set(e.b, (g.get(e.b) ?? 0) + 1); }
  return g;
}

// ---------- simnet ----------

const hoekWiskunde = (dx, dy) => Math.atan2(-dy, dx); // y omhoog, tegen de klok in positief
const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
// Ligt x strikt op de boog van a tegen de klok in naar b?
const opBoog = (x, a, b) => { const ab = norm(b - a), ax = norm(x - a); return ax > 1e-9 && ax < ab - 1e-9; };

// Richting vanaf de knoop de arm in, gemeten op ~8 m (de eerste punten liggen soms vrijwel op de knoop).
function armHoek(pts, vanafBegin) {
  const p = vanafBegin ? pts : [...pts].reverse();
  const [x0, y0] = p[0];
  for (let i = 1; i < p.length; i++) if (Math.hypot(p[i][0] - x0, p[i][1] - y0) > 8 || i === p.length - 1) return hoekWiskunde(p[i][0] - x0, p[i][1] - y0);
  return 0;
}

export const linkSleutel = (edgeId, dir) => `${edgeId}:${dir}`;
export const beweegSleutel = (inKey, uitKey) => `${inKey}>${uitKey}`;

export const STROOK = 3.2; // m per rijstrook, voor tekenen

// kaart -> simnet. Gooit niets weg uit de kaart.
export function bouwSimnet(kaart) {
  const nodes = [], nodeIdx = new Map();
  for (const k of Object.values(kaart.nodes)) { nodeIdx.set(k.id, nodes.length); nodes.push({ i: nodes.length, id: k.id, x: k.x, y: k.y, ctrl: k.ctrl, inn: [], uit: [], moves: [], arms: [], verboden: [] }); }
  const links = [];
  for (const e of Object.values(kaart.edges)) {
    const kl = klasseVan(e.cls);
    for (const dir of ['f', 'b']) {
      const lanes = dir === 'f' ? e.lanesF : e.lanesB;
      if (!lanes) continue;
      const pts = dir === 'f' ? e.pts : [...e.pts].reverse();
      const from = nodeIdx.get(dir === 'f' ? e.a : e.b), to = nodeIdx.get(dir === 'f' ? e.b : e.a);
      if (from == null || to == null) continue;
      const len = Math.max(1, lengteVan(pts));
      const L = {
        i: links.length, key: linkSleutel(e.id, dir), edge: e.id, dir, from, to, pts, cum: cumulatief(pts), len,
        lanes, vmax: e.kmh / 3.6, cls: e.cls, rang: e.rotonde ? 10 : kl.rang, rotonde: !!e.rotonde,
        eenrichting: !(e.lanesF && e.lanesB), uitMoves: [], naam: e.naam, nieuw: !!e.nieuw,
      };
      links.push(L);
      nodes[from].uit.push(L.i); nodes[to].inn.push(L.i);
    }
  }
  // Armen per knoop: één per wegvak, met de hoek waaronder het wegvak de knoop verlaat.
  for (const e of Object.values(kaart.edges)) {
    const a = nodeIdx.get(e.a), b = nodeIdx.get(e.b);
    if (a == null || b == null) continue;
    nodes[a].arms.push({ edge: e.id, hoek: armHoek(e.pts, true) });
    nodes[b].arms.push({ edge: e.id + (a === b ? '#2' : ''), hoek: armHoek(e.pts, false) });
  }
  const moves = [];
  const EPS = 0.06; // rad: rechts rijden, inkomend verkeer ligt iets tegen de klok in van de arm, uitgaand iets met de klok mee
  for (const N of nodes) {
    const armVan = (L, inkomend) => {
      const l = links[L];
      // Lus (a == b): onderscheid op richting.
      const lus = kaart.edges[l.edge].a === kaart.edges[l.edge].b;
      if (!lus) return N.arms.find((a) => a.edge === l.edge);
      const begin = inkomend ? l.dir === 'b' : l.dir === 'f';
      return N.arms.find((a) => a.edge === (begin ? l.edge : l.edge + '#2'));
    };
    const doodlopend = N.arms.length === 1;
    if (N.ctrl === 'rand') continue; // aan de rand verlaat verkeer het gebied, er wordt niet gekeerd
    for (const li of N.inn) for (const lo of N.uit) {
      const A = links[li], B = links[lo];
      const keren = A.edge === B.edge && kaart.edges[A.edge].a !== kaart.edges[A.edge].b;
      if (keren && !doodlopend) continue;
      const armIn = armVan(li, true), armUit = armVan(lo, false);
      if (!armIn || !armUit) continue;
      const hIn = armIn.hoek + EPS, hUit = armUit.hoek - EPS;
      // Draai: hoek tussen rijrichting erin en eruit (links positief).
      const rijIn = norm(armIn.hoek + Math.PI), draai = norm(armUit.hoek - rijIn + Math.PI) - Math.PI;
      const soort = keren ? 'U' : draai > 0.6 ? 'L' : draai < -0.6 ? 'R' : 'S';
      if (kaart.verboden[beweegSleutel(A.key, B.key)]) { N.verboden.push({ from: li, to: lo, soort, key: beweegSleutel(A.key, B.key), hIn }); continue; }
      const M = { i: moves.length, from: li, to: lo, node: N.i, hIn, hUit, armIn: armIn.edge, armUit: armUit.edge, soort, conflict: [], wijktVoor: [], key: beweegSleutel(A.key, B.key) };
      moves.push(M); N.moves.push(M.i); A.uitMoves.push(M.i);
    }
  }
  // Conflicten en voorrang per knoop.
  for (const N of nodes) {
    const ms = N.moves.map((i) => moves[i]);
    for (const m1 of ms) for (const m2 of ms) {
      if (m1.i >= m2.i || m1.from === m2.from) continue;
      const samen = m1.to === m2.to;
      const kruis = !samen && m1.armUit !== m2.armUit && opBoog(m2.hIn, m1.hIn, m1.hUit) !== opBoog(m2.hUit, m1.hIn, m1.hUit);
      if (!samen && !kruis) continue;
      m1.conflict.push(m2.i); m2.conflict.push(m1.i);
      // Wie heeft voorrang? (m1 wint -> m2 wijkt)
      const win = voorrang(N, m1, m2, links);
      if (win === m1) m2.wijktVoor.push(m1.i); else m1.wijktVoor.push(m2.i);
    }
  }
  const net = { nodes, links, moves, kaart, regelaars: [] };
  bouwRegelaars(net);
  return net;
}

// Voorrang tussen twee conflicterende bewegingen op knoop N. Geeft de winnaar terug.
function voorrang(N, m1, m2, links) {
  const r1 = links[m1.from].rang, r2 = links[m2.from].rang;
  if (N.ctrl !== 'vri' && r1 !== r2) {
    if (N.ctrl !== 'rotonde') return r1 > r2 ? m1 : m2;
  }
  // Relatieve positie van de arm van m1, gezien vanuit m2.
  const rel = norm(m1.hIn - m2.hIn);
  const deg = (rel * 180) / Math.PI;
  const vanRechts1 = deg > 45 && deg < 135; // m1 komt van rechts voor m2
  const vanLinks1 = deg > 225 && deg < 315;
  if (N.ctrl === 'rotonde') {
    // Op een rotonde gaat verkeer van links (dat al rondrijdt) voor.
    if (vanLinks1) return m1;
    if (vanRechts1) return m2;
  } else if (N.ctrl !== 'vri') {
    if (vanRechts1) return m1;
    if (vanLinks1) return m2;
  }
  // Tegenover elkaar (of VRI met gelijktijdig groen): linksaf wijkt, dan rechtsaf, dan op volgorde.
  const gewicht = { S: 0, R: 1, L: 2, U: 3 };
  if (gewicht[m1.soort] !== gewicht[m2.soort]) return gewicht[m1.soort] < gewicht[m2.soort] ? m1 : m2;
  if (N.ctrl === 'vri' && r1 !== r2) return r1 > r2 ? m1 : m2;
  return m1;
}

// VRI's: knopen met ctrl 'vri' die via korte wegvakken (< 45 m) aan elkaar zitten vormen één regelaar.
// Langs een rotonde niet: daar is elke ingang een eigen regelaar (ring en ingang om beurten).
// Aanrijlinks (van buiten de groep) krijgen een fase; tegenover elkaar liggende richtingen delen een fase.
// De lichten zelf (verkeersafhankelijk) regelt sim.js.
function bouwRegelaars(net) {
  const { nodes, links } = net;
  const groep = new Map();
  for (const N of nodes) {
    if (N.ctrl !== 'vri' || groep.has(N.i)) continue;
    const leden = [N.i], stapel = [N.i];
    groep.set(N.i, net.regelaars.length);
    while (stapel.length) {
      const k = stapel.pop();
      for (const li of [...nodes[k].inn, ...nodes[k].uit]) {
        const L = links[li], ander = L.from === k ? L.to : L.from;
        if (L.len < 45 && !L.rotonde && nodes[ander].ctrl === 'vri' && !groep.has(ander)) { groep.set(ander, net.regelaars.length); leden.push(ander); stapel.push(ander); }
      }
    }
    const lid = new Set(leden);
    const aanrij = leden.flatMap((k) => nodes[k].inn).filter((li) => !lid.has(links[li].from));
    // Rijrichting bij aankomst.
    const koers = (li) => { const p = links[li].pts, n = p.length; return Math.atan2(p[n - 1][1] - p[n - 2][1], p[n - 1][0] - p[n - 2][0]); };
    const fasen = [], over = new Set(aanrij);
    for (const li of aanrij) {
      if (!over.has(li)) continue;
      const k0 = koers(li);
      const fase = [...over].filter((lj) => { const d = Math.abs(norm(koers(lj) - k0 + Math.PI) - Math.PI); return d < 0.7 || d > Math.PI - 0.7; });
      fase.forEach((lj) => over.delete(lj));
      fasen.push(fase);
    }
    const R = { i: net.regelaars.length, leden, fasen, faseVan: new Map() };
    fasen.forEach((f, fi) => f.forEach((li) => R.faseVan.set(li, fi)));
    net.regelaars.push(R);
  }
  for (const L of links) L.regelaar = null;
  for (const R of net.regelaars) for (const li of R.faseVan.keys()) links[li].regelaar = R.i;
}


// Punt op de kaart -> plekken op het simnet (beide rijrichtingen van het dichtstbijzijnde wegvak).
export function vangPunt(net, x, y, max = 80) {
  const kaart = net.kaart;
  let best = null;
  for (const e of Object.values(kaart.edges)) {
    if (kaart.nodes[e.a]?.ctrl === 'rand' && kaart.nodes[e.b]?.ctrl === 'rand') continue;
    const p = dichtstbijOpLijn(e.pts, x, y);
    if (p.d < (best?.p.d ?? max)) best = { e, p };
  }
  if (!best) return null;
  const plekken = [];
  for (const L of net.links) {
    if (L.edge !== best.e.id) continue;
    const pos = L.dir === 'f' ? best.p.s : L.len - best.p.s;
    plekken.push({ link: L.i, pos: Math.max(0.5, Math.min(L.len - 0.5, pos)) });
  }
  return { plekken, x: best.p.x, y: best.p.y, edge: best.e.id };
}

export const lengteVanEdge = (e) => lengteVan(e.pts);
