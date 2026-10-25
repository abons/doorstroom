// Microsimulatie: losse auto's per rijstrook (IDM-volgmodel), voorrang/VRI op kruisingen, routes over gemeten
// reistijden. Puur rekenwerk zonder DOM, zodat test.mjs het in Node kan draaien.
import { klasseVan } from './net.js';

export const DT = 0.25; // s per stap
const LEN = 4.5, S0 = 2, B = 2.0, MAX_AUTOS = 5000;
const GAP = 3.0, VRIJ_NA = 2.0, BEZET = 0.9, GEDULD = 14, OPGEVEN = 180;
const DRAAI = { S: 0, R: 2, L: 3.5, U: 6 };
const BOCHT = { R: 5, L: 6.5, U: 3 };

// Vraag per uur: instroom aan de rand per rijstrook, en lokaal (woningen/bedrijven langs de weg) per km.
const RAND_PER_STROOK = { motorway: 1400, trunk: 900, primary: 550, secondary: 380, tertiary: 200, unclassified: 70, residential: 35, living_street: 8 };
const LOKAAL_PER_KM = { tertiary: 25, unclassified: 25, residential: 30, living_street: 15, secondary: 10, primary: 5 };

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function hash(t) {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function maakSim(net, { drukte = 1, seed = 1, start = 7 * 3600 } = {}) {
  const { links, moves, nodes } = net;
  const movVrij = new Float64Array(moves.length), movTijd = new Float64Array(moves.length);
  const laatstePas = new Float64Array(moves.length).fill(-1e9), laatsteMeting = new Float64Array(moves.length).fill(-1e9);
  for (const m of moves) {
    const L = links[m.from];
    movVrij[m.i] = L.len / L.vmax + DRAAI[m.soort] + (L.regelaar != null ? 8 : 0);
    movTijd[m.i] = movVrij[m.i];
  }
  for (const L of links) {
    L.banen = Array.from({ length: L.lanes }, () => []);
    L.naarMove = new Map(L.uitMoves.map((mi) => [moves[mi].to, mi]));
    L.snelheid = 1;
  }
  const sim = {
    net, t: 0, start, drukte, random: rng(seed), movVrij, movTijd, laatstePas, laatsteMeting,
    herkomst: [], doelen: [], doelCum: [], routeCache: new Map(), ritten: [], autos: 0, volgnr: 1,
    proeven: [], proefRitten: new Map(), stappen: 0,
    vri: net.regelaars.map(() => ({ fase: 0, stand: 'groen', t: 0 })),
  };
  // Herkomsten en bestemmingen.
  for (const L of links) {
    const kl = L.cls.replace(/_link$/, '');
    if (nodes[L.from].ctrl === 'rand') {
      sim.herkomst.push({ link: L.i, pos: 0, perUur: (RAND_PER_STROOK[kl] ?? 50) * L.lanes * (L.cls.endsWith('_link') ? 0.5 : 1), rand: true, wacht: [] });
    }
    if (nodes[L.to].ctrl === 'rand') sim.doelen.push({ link: L.i, pos: L.len - 0.5, gewicht: (RAND_PER_STROOK[kl] ?? 50) * L.lanes, rand: true });
    const lok = L.nieuw ? 0 : LOKAAL_PER_KM[kl]; // langs een nieuwe weg staan (nog) geen huizen
    if (lok && L.len > 30 && nodes[L.from].ctrl !== 'rand' && nodes[L.to].ctrl !== 'rand') {
      const f = (L.len / 1000) * lok * (L.eenrichting ? 1 : 0.5);
      sim.herkomst.push({ link: L.i, pos: L.len / 2, perUur: f, rand: false, wacht: [] });
      sim.doelen.push({ link: L.i, pos: L.len / 2, gewicht: f, rand: false });
    }
  }
  // Gemeenschappelijke toevalsgetallen: elke herkomst heeft een eigen toevalsstroom, afgeleid van zijn plek in de
  // kaart en niet van zijn volgnummer. Vóór en na een bewerking rijden zo vrijwel dezelfde ritten, en komt een
  // verschil van de ingreep in plaats van van toeval.
  const sleutel = (x) => `${links[x.link].key}:${x.rand ? 'r' : 'l'}`;
  sim.doelen.sort((a, b) => (sleutel(a) < sleutel(b) ? -1 : 1));
  for (const h of sim.herkomst) h.random = rng(hash(`${seed}:${sleutel(h)}`));
  let c = 0;
  sim.doelCum = sim.doelen.map((d) => (c += d.gewicht));
  return sim;
}

// ---------- verkeerslichten ----------
// Verkeersafhankelijk, zoals vrijwel elke Nederlandse VRI: groen blijft zolang er auto's aankomen (tot een maximum),
// en springt door naar de volgende fase waar iemand staat te wachten. Zonder vraag blijft het laatste groen staan.
export const VRI = { minGroen: 6, maxGroen: 30, geel: 3, rood: 2, lus: 35, wachtLus: 60 };

function vraagOp(sim, links, lus, alleenWachtend) {
  for (const li of links) {
    const L = sim.net.links[li];
    for (const baan of L.banen) {
      const f = baan[0];
      if (f && L.len - f.x < lus && (!alleenWachtend || f.v < 3 || L.len - f.x < 15) && f.mv >= 0) return true;
    }
  }
  return false;
}

function regelLichten(sim) {
  sim.net.regelaars.forEach((R, i) => {
    const s = sim.vri[i];
    s.t += DT;
    if (s.stand === 'groen') {
      if (s.t < VRI.minGroen || R.fasen.length < 2) return;
      const anders = R.fasen.some((f, fi) => fi !== s.fase && vraagOp(sim, f, VRI.wachtLus, true));
      if (!anders) return;
      if (s.t >= VRI.maxGroen || !vraagOp(sim, R.fasen[s.fase], VRI.lus, false)) { s.stand = 'geel'; s.t = 0; }
    } else if (s.stand === 'geel') {
      if (s.t >= VRI.geel) { s.stand = 'rood'; s.t = 0; }
    } else if (s.t >= VRI.rood) {
      let volgende = (s.fase + 1) % R.fasen.length;
      for (let k = 1; k <= R.fasen.length; k++) {
        const fi = (s.fase + k) % R.fasen.length;
        if (vraagOp(sim, R.fasen[fi], VRI.wachtLus, true)) { volgende = fi; break; }
      }
      s.fase = volgende; s.stand = 'groen'; s.t = 0;
    }
  });
}

// Lichtstand voor link li: 'groen' | 'geel' | 'rood' | null (geen VRI).
export function lichtVoor(sim, li) {
  const L = sim.net.links[li];
  if (L.regelaar == null) return null;
  const R = sim.net.regelaars[L.regelaar], s = sim.vri[L.regelaar], f = R.faseVan.get(li);
  if (s.stand === 'rood' || f !== s.fase) return 'rood';
  return s.stand;
}

// ---------- routes ----------

function heapPush(h, item) { h.push(item); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } }
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } }
  return top;
}

// Snelste route over de huidige (gemeten) reistijden. starts/doelen: [{link, pos}]. vrij=true rekent met de
// lege-weg-tijden. Geeft { pad: [linkIdx], tijd, start, doel } of null.
export function zoekRoute(sim, starts, doelen, vrij = false) {
  const { links, moves } = sim.net, kost = vrij ? sim.movVrij : sim.movTijd;
  const doelVan = new Map(doelen.map((d) => [d.link, d]));
  const dist = new Map(), vorig = new Map(), h = [];
  let best = null;
  for (const s of starts) {
    const L = links[s.link], rest = 1 - s.pos / L.len;
    const d = doelVan.get(s.link);
    if (d && d.pos >= s.pos) { const tijd = (d.pos - s.pos) / L.vmax; if (!best || tijd < best.tijd) best = { pad: [s.link], tijd, start: s, doel: d }; }
    for (const mi of L.uitMoves) {
      const t = rest * kost[mi], to = moves[mi].to;
      if (t < (dist.get(to) ?? Infinity)) { dist.set(to, t); vorig.set(to, { link: s.link, start: s }); heapPush(h, [t, to]); }
    }
  }
  while (h.length) {
    const [t, li] = heapPop(h);
    if (t > (dist.get(li) ?? Infinity)) continue;
    if (best && t >= best.tijd) break;
    const L = links[li], d = doelVan.get(li);
    if (d) {
      const tijd = t + (d.pos / L.len) * (L.len / L.vmax);
      if (!best || tijd < best.tijd) {
        const pad = [li]; let k = li, start;
        while (vorig.has(k)) { const v = vorig.get(k); pad.push(v.link); if (v.start) { start = v.start; break; } k = v.link; }
        best = { pad: pad.reverse(), tijd, start, doel: d };
      }
    }
    for (const mi of L.uitMoves) {
      const to = moves[mi].to, nt = t + kost[mi];
      if (nt < (dist.get(to) ?? Infinity)) { dist.set(to, nt); vorig.set(to, { link: li }); heapPush(h, [nt, to]); }
    }
  }
  return best;
}

// Lege-weg-tijd van een pad (zonder wachten en afslaan): voor het doorstroomcijfer.
function vrijeTijd(sim, pad, pos0, posEind) {
  const { links } = sim.net;
  let t = 0;
  pad.forEach((li, k) => {
    const L = links[li];
    const van = k === 0 ? pos0 : 0, tot = k === pad.length - 1 ? posEind : L.len;
    t += Math.max(0, tot - van) / L.vmax;
  });
  return t;
}

// ---------- autos ----------

function kiesDoel(sim, random) {
  const r = random() * sim.doelCum[sim.doelCum.length - 1];
  let lo = 0, hi = sim.doelCum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sim.doelCum[m] < r) lo = m + 1; else hi = m; }
  return lo;
}

// Rijstrook op link L voor een auto die daarna beweging 'soort' maakt: rechtsaf rechts, linksaf links, anders de rustigste.
function kiesBaan(L, soort) {
  if (L.lanes === 1) return 0;
  if (soort === 'R') return 0;
  if (soort === 'L' || soort === 'U') return L.lanes - 1;
  let best = 0, bestScore = Infinity;
  L.banen.forEach((b, i) => { const st = b.length + (b.length ? -b[b.length - 1].x / 1000 : 0); if (st < bestScore) { bestScore = st; best = i; } });
  return best;
}

function soortNa(sim, auto, ri) {
  const { links, moves } = sim.net;
  if (ri + 1 >= auto.pad.length) return 'S';
  const mi = links[auto.pad[ri]].naarMove.get(auto.pad[ri + 1]);
  return mi == null ? 'S' : moves[mi].soort;
}

// Plaatst een auto op link li vanaf positie pos. Geeft false als er geen ruimte is.
function plaats(sim, auto, li, pos, v) {
  const L = sim.net.links[li];
  const voorkeur = kiesBaan(L, soortNa(sim, auto, 0));
  const volgorde = [voorkeur, ...L.banen.map((_, i) => i).filter((i) => i !== voorkeur)];
  for (const b of volgorde) {
    const baan = L.banen[b];
    let k = 0; // eerste auto achter pos
    while (k < baan.length && baan[k].x > pos) k++;
    const voor = baan[k - 1], achter = baan[k];
    if (voor && voor.x - LEN - pos < S0 + 4) continue;
    if (achter && pos - LEN - achter.x < S0 + 4) continue;
    auto.link = li; auto.baan = b; auto.x = pos; auto.v = voor ? Math.min(v, voor.v) : v; auto.tLink = sim.t; auto.heelLink = pos === 0;
    baan.splice(k, 0, auto);
    sim.autos++;
    return true;
  }
  return false;
}

function nieuweAuto(sim, pad, doel, t0, vrij, proef = null, r = sim.random) {
  return {
    id: sim.volgnr++, pad, ri: 0, doel, t0, vrij, proef,
    v0f: 0.92 + r() * 0.16, T: 1.0 + r() * 0.5, a: 1.2 + r() * 0.6,
    gaat: false, wacht: 0, volgBaan: -1, mv: -1, kleur: Math.floor(r() * 6),
  };
}

function routeVoor(sim, hi, di) {
  const key = hi * 100000 + di;
  const hit = sim.routeCache.get(key);
  if (hit && sim.t - hit.t < 120) return hit.r;
  const h = sim.herkomst[hi], d = sim.doelen[di];
  const r = zoekRoute(sim, [h], [d]);
  sim.routeCache.set(key, { t: sim.t, r });
  return r;
}

function spawn(sim) {
  sim.herkomst.forEach((h, hi) => {
    // Altijd evenveel trekkingen per stap, wat er verder ook gebeurt: dan blijft de stroom gelijk tussen scenario's.
    const r = h.random, kans = (h.perUur * sim.drukte * DT) / 3600, trek = r(), doelTrek = r();
    if (trek < kans && h.wacht.length < 30) {
      const di = kiesDoel(sim, () => doelTrek);
      const d = sim.doelen[di];
      // Aan de rand terug naar dezelfde weg zou alleen keren zijn; met een rotonde kan dat ineens wel (2026-10-25).
      const terug = h.rand && d.rand && d.link !== h.link && sim.net.links[h.link].edge === sim.net.links[d.link].edge;
      if (!terug && !(d.link === h.link && d.pos <= h.pos)) h.wacht.push({ t: sim.t, di, rr: rng(Math.floor(doelTrek * 4294967296)) });
    }
    if (!h.wacht.length || sim.autos >= MAX_AUTOS) return;
    const w = h.wacht[0];
    const route = routeVoor(sim, hi, w.di);
    if (!route) { h.wacht.shift(); return; }
    const L = sim.net.links[h.link], d = sim.doelen[w.di];
    const auto = nieuweAuto(sim, route.pad, d, w.t, vrijeTijd(sim, route.pad, h.pos, d.pos), null, w.rr);
    if (plaats(sim, auto, h.link, h.pos, h.rand ? L.vmax * 0.8 : 0)) h.wacht.shift();
  });
  // Proefritten voor de routeplanner: elke 60 s één per route.
  for (const p of sim.proeven) {
    if (sim.t < (p.volgende ?? 0)) continue;
    const route = zoekRoute(sim, p.van, p.naar);
    if (!route) { p.volgende = sim.t + 60; continue; }
    const auto = nieuweAuto(sim, route.pad, route.doel, sim.t, vrijeTijd(sim, route.pad, route.start.pos, route.doel.pos), p.id);
    auto.v0f = 1; auto.T = 1.2; auto.a = 1.5;
    if (plaats(sim, auto, route.start.link, route.start.pos, 0)) p.volgende = sim.t + 60;
  }
}

// IDM-versnelling.
function idm(auto, v0, gap, dv) {
  const v = auto.v;
  const sStar = S0 + Math.max(0, v * auto.T + (v * dv) / (2 * Math.sqrt(auto.a * B)));
  const g = Math.max(gap, 0.1);
  return auto.a * (1 - (v / Math.max(v0, 0.1)) ** 4 - (sStar / g) ** 2);
}

// Bezetting van de ring waar link N in ligt (0..1): de ringstukken vind je door rotonde-bewegingen te volgen.
function ringVol(sim, N) {
  const { links, moves } = sim.net;
  if (!N.ring) {
    const ring = [N], gezien = new Set([N.i]);
    for (let L = N; ;) {
      const vervolg = L.uitMoves.map((mi) => links[moves[mi].to]).find((x) => x.rotonde);
      if (!vervolg || gezien.has(vervolg.i)) break;
      ring.push(vervolg); gezien.add(vervolg.i); L = vervolg;
    }
    for (const L of ring) L.ring = ring;
  }
  let autos = 0, ruimte = 0;
  for (const L of N.ring) { ruimte += L.len * L.lanes; for (const b of L.banen) autos += b.length; }
  return (autos * (LEN + S0)) / ruimte;
}

// Kruispunt vrijhouden (zoals TM:PE's "enter blocked junction" uit): wie een kruispunt van meerdere knopen op rijdt,
// moet op elk binnenstuk van zijn pad plek hebben én op de weg erna. Zonder dit stonden op een kruising met
// gescheiden rijbanen de vier binnenstukken rondom vol linksafslaers en liep alles vast (0 ritten/u, 2026-10-25).
function kanErAf(sim, auto) {
  const { links } = sim.net, plek = LEN + S0;
  for (let j = auto.ri + 1; j < auto.pad.length; j++) {
    const K = links[auto.pad[j]];
    if (!K.binnen) return K.banen.some((b) => !b.length || b.at(-1).x >= plek + 1); // en op de weg erna
    // Per strook: de strook die hij daar zou kiezen (rechtdoor: elke strook) moet plek hebben.
    const soort = soortNa(sim, auto, j), past = (b) => (b.length + 1) * plek <= Math.max(K.len, plek);
    if (!(soort === 'S' || K.lanes === 1 ? K.banen.some(past) : past(K.banen[kiesBaan(K, soort)]))) return false;
  }
  return true;
}

// Mag de voorste auto op zijn link de kruising op? Zet ook auto.volgBaan.
function magGaan(sim, auto, L, m) {
  const { links, moves } = sim.net;
  const licht = lichtVoor(sim, L.i);
  const rest = L.len - auto.x;
  if (licht === 'rood') return false;
  if (licht === 'geel' && rest > (auto.v * auto.v) / (2 * 3) + 1) return false;
  const N = links[m.to];
  if (auto.volgBaan < 0 || auto.volgBaan >= N.lanes) auto.volgBaan = kiesBaan(N, soortNa(sim, auto, auto.ri + 1));
  const staart = N.banen[auto.volgBaan].at(-1);
  if (staart && staart.x < LEN + S0 + 1 && !(sim.net.links[m.to].len < 10 && staart.v > 2)) return false; // kruising niet blokkeren
  // Een ring met lichten liep helemaal vol en dan vast (ringverkeer staat voor rood, de ingangen vullen elk gat).
  // Dus bij een geregelde ingang alleen de ring op als de hele ring hoogstens half vol staat (2026-10-25).
  if (licht && !L.rotonde && N.rotonde && ringVol(sim, N) > 0.5) return false;
  if (!L.binnen && N.binnen && sim.net.links[auto.pad[auto.ri + 2]]?.binnen && !kanErAf(sim, auto)) return false;
  for (const ni of m.conflict) if (sim.t - sim.laatstePas[ni] < BEZET) return false; // er rijdt net iemand over de kruising
  const rotonde = sim.net.nodes[m.node].ctrl === 'rotonde' || L.rotonde === false && links[m.to].rotonde;
  for (const ni of m.wijktVoor) {
    if (sim.t - sim.laatstePas[ni] < (rotonde ? 1.4 : VRIJ_NA)) return false;
    if (auto.wacht > GEDULD) continue;
    const n = moves[ni], K = links[n.from];
    if (lichtVoor(sim, K.i) === 'rood') continue;
    for (const baan of K.banen) {
      const f = baan[0];
      if (!f || f.mv !== ni) continue;
      const afst = K.len - f.x;
      const tta = afst / Math.max(f.v, 0.5);
      if ((f.gaat || f.v > 2) && tta < (rotonde ? 2.5 : GAP) && afst < 120) return false;
    }
  }
  return true;
}

export function stap(sim) {
  const { links, moves } = sim.net;
  spawn(sim);
  regelLichten(sim);
  // 1. versnellingen bepalen
  for (const L of links) {
    for (const baan of L.banen) {
      for (let k = 0; k < baan.length; k++) {
        const auto = baan[k], v0 = L.vmax * auto.v0f;
        let acc;
        if (k > 0) {
          const voor = baan[k - 1];
          acc = idm(auto, v0, voor.x - LEN - auto.x, auto.v - voor.v);
          auto.gaat = false;
        } else if (auto.ri === auto.pad.length - 1) {
          acc = idm(auto, v0, 1e4, 0); auto.gaat = false; auto.mv = -1;
        } else {
          const mi = L.naarMove.get(auto.pad[auto.ri + 1]);
          auto.mv = mi ?? -1;
          const rest = L.len - auto.x;
          if (mi == null) { acc = idm(auto, v0, rest, auto.v); auto.gaat = false; }
          else if (rest > Math.max(60, (auto.v * auto.v) / (2 * B) + 25)) { acc = idm(auto, v0, 1e4, 0); auto.gaat = false; }
          else {
            const m = moves[mi];
            const N = links[m.to];
            const bocht = sim.net.nodes[m.node].ctrl === 'rotonde' || N.rotonde ? 7 : BOCHT[m.soort] ?? Math.min(N.vmax, L.vmax);
            const v0b = Math.min(v0, Math.sqrt(bocht * bocht + 2 * 1.5 * rest));
            auto.gaat = magGaan(sim, auto, L, m);
            if (!auto.gaat) acc = idm(auto, v0b, rest - 1, auto.v);
            else {
              const staart = N.banen[auto.volgBaan].at(-1);
              acc = staart ? idm(auto, v0b, rest + staart.x - LEN, auto.v - staart.v) : idm(auto, v0b, 1e4, 0);
            }
          }
        }
        auto.acc = Math.max(-9, acc);
      }
    }
  }
  // 2. bewegen
  for (const L of links) for (const baan of L.banen) for (const auto of baan) {
    const v1 = Math.max(0, auto.v + auto.acc * DT);
    auto.x += auto.v < 1e-6 && auto.acc <= 0 ? 0 : (auto.v + v1) * 0.5 * DT;
    auto.v = v1;
    if (auto.v < 0.3) auto.wacht += DT; else auto.wacht = 0;
  }
  // 3. aankomen en oversteken (voorste auto's; per baan zo lang er iets te doen is)
  for (const L of links) for (const baan of L.banen) {
    // Achterliggers mogen niet door hun voorganger heen (numeriek): vastklemmen.
    for (let k = 1; k < baan.length; k++) if (baan[k].x > baan[k - 1].x - LEN - 0.2) { baan[k].x = baan[k - 1].x - LEN - 0.2; baan[k].v = Math.min(baan[k].v, baan[k - 1].v); }
    while (baan.length) {
      const auto = baan[0];
      // Vastgelopen (Cities: Skylines "despawn"): wie OPGEVEN s stilstaat vooraan, verdwijnt. Anders zet een stad op
      // 200 % drukte zich binnen het uur helemaal vast (Amersfoort-demo: 156 ritten/u, 2026-10-25). De rit telt mee
      // met de tijd tot dan, zodat doorstroom niet mooier wordt; meting telt ze apart.
      if (auto.wacht > OPGEVEN) { baan.shift(); sim.autos--; sim.ritten.push({ t: sim.t, tijd: sim.t - auto.t0, vrij: auto.vrij, opgegeven: true }); continue; }
      if (auto.ri === auto.pad.length - 1) {
        if (auto.x >= auto.doel.pos || auto.x >= L.len) { baan.shift(); sim.autos--; klaar(sim, auto); continue; }
        break;
      }
      if (auto.x < L.len) break;
      if (!auto.gaat || auto.mv < 0) { auto.x = L.len - 0.01; auto.v = 0; break; }
      const m = moves[auto.mv], N = links[m.to];
      sim.laatstePas[m.i] = sim.t;
      if (auto.heelLink) {
        const monster = sim.t - auto.tLink;
        sim.movTijd[m.i] = 0.85 * sim.movTijd[m.i] + 0.15 * Math.max(monster, sim.movVrij[m.i] * 0.7);
        sim.laatsteMeting[m.i] = sim.t;
      }
      baan.shift();
      const b = auto.volgBaan >= 0 && auto.volgBaan < N.lanes ? auto.volgBaan : 0;
      const staart = N.banen[b].at(-1);
      auto.x = Math.min(auto.x - L.len, N.len - 0.1, staart ? staart.x - LEN - 0.2 : Infinity);
      if (auto.x < 0) auto.x = 0;
      auto.link = N.i; auto.baan = b; auto.ri++; auto.tLink = sim.t; auto.heelLink = true;
      auto.volgBaan = -1; auto.gaat = false; auto.wacht = 0;
      N.banen[b].push(auto);
    }
  }
  sim.t += DT;
  sim.stappen++;
  // 4. elke seconde: snelheid per link (kleur), en reistijden zonder recente metingen langzaam terug naar leeg
  if (sim.stappen % 4 === 0) {
    for (const L of links) {
      let s = 0, n = 0;
      for (const baan of L.banen) for (const a of baan) { s += a.v / L.vmax; n++; }
      L.snelheid = n ? 0.7 * L.snelheid + 0.3 * Math.min(1, s / n) : 0.9 * L.snelheid + 0.1;
      L.aantal = n;
    }
  }
  if (sim.stappen % 120 === 0) {
    for (let i = 0; i < moves.length; i++) if (sim.t - sim.laatsteMeting[i] > 60) sim.movTijd[i] += 0.2 * (sim.movVrij[i] - sim.movTijd[i]);
    sim.routeCache.clear();
  }
}

function klaar(sim, auto) {
  const tijd = sim.t - auto.t0;
  sim.ritten.push({ t: sim.t, tijd, vrij: auto.vrij });
  if (sim.ritten.length > 4000) sim.ritten.splice(0, 1000);
  if (auto.proef != null) {
    const lijst = sim.proefRitten.get(auto.proef) ?? [];
    lijst.push({ t: sim.t, tijd, pad: auto.pad });
    if (lijst.length > 10) lijst.shift();
    sim.proefRitten.set(auto.proef, lijst);
  }
}

// Kerncijfers over de laatste 'venster' seconden simtijd.
export function meting(sim, venster = 600) {
  const r = sim.ritten.filter((x) => x.t > sim.t - venster);
  const tijd = r.reduce((a, x) => a + x.tijd, 0), vrij = r.reduce((a, x) => a + x.vrij, 0);
  const duur = Math.min(venster, Math.max(sim.t, 1));
  let wachtrij = 0;
  for (const h of sim.herkomst) wachtrij += h.wacht.length;
  return {
    doorstroom: tijd ? Math.min(1, vrij / tijd) : 1,
    gemReistijd: r.length ? tijd / r.length : 0,
    verliesPerUur: ((tijd - vrij) / 3600) * (3600 / duur),
    rittenPerUur: (r.length * 3600) / duur,
    opgegevenPerUur: (r.filter((x) => x.opgegeven).length * 3600) / duur,
    autos: sim.autos,
    wachtrij,
  };
}

// Mediaan van de laatste proefritten voor een route-id.
export function proefTijd(sim, id) {
  const l = (sim.proefRitten.get(id) ?? []).map((x) => x.tijd).sort((a, b) => a - b);
  return l.length ? l[l.length >> 1] : null;
}

export function draaiTot(sim, t) { while (sim.t < t) stap(sim); }

export { klasseVan };
