// Een scenario meten: verse simulaties (vaste seeds) opwarmen en dan een vaste tijd meten, met een proefauto per
// route. Vóór en na draaien zo onder precies dezelfde vraag, dus het verschil komt van de ingreep en niet van toeval.
import { bouwSimnet, vangPunt } from './net.js';
import { maakSim, stap, meting, zoekRoute } from './sim.js';

export const OPWARM = 600, MEETDUUR = 1800;

export function proevenVoor(net, routes) {
  const uit = [];
  for (const r of routes) {
    const a = vangPunt(net, ...r.A), b = r.B && vangPunt(net, ...r.B);
    if (a && b) uit.push({ id: r.id, van: a.plekken, naar: b.plekken });
  }
  return uit;
}

// Verkeer is chaotisch: zelfs een ingreep zonder effect verschuift de uitkomst van één run een paar procent. Daarom
// het gemiddelde van SEEDS runs; verschillen kleiner dan RUIS noemt de pagina 'gelijk'.
export const SEEDS = [7, 8, 9];
export const RUIS = { doorstroom: 0.02, reistijd: 0.03 };

export async function meetScenario(kaart, routes, { drukte = 1, seeds = SEEDS } = {}, voortgang = () => {}) {
  const runs = [];
  for (let k = 0; k < seeds.length; k++) {
    const r = await meetRun(kaart, routes, drukte, seeds[k], (f) => voortgang((k + f) / seeds.length));
    if (!r) return null;
    runs.push(r);
  }
  const gem = (f) => { const l = runs.map(f).filter((x) => x != null); return l.length ? l.reduce((a, b) => a + b, 0) / l.length : null; };
  const uit = { meting: {}, routes: {} };
  for (const k of Object.keys(runs[0].meting)) uit.meting[k] = gem((r) => r.meting[k]);
  for (const id of Object.keys(runs[0].routes)) {
    const ritten = runs.flatMap((r) => r.routes[id].ritten).sort((a, b) => a - b);
    uit.routes[id] = {
      verwacht: gem((r) => r.routes[id].verwacht),
      gereden: ritten.length ? ritten[ritten.length >> 1] : null,
      lengte: runs[0].routes[id].lengte,
    };
  }
  return uit;
}

async function meetRun(kaart, routes, drukte, seed, voortgang) {
  const net = bouwSimnet(kaart);
  const sim = maakSim(net, { drukte, seed });
  sim.proeven = proevenVoor(net, routes);
  const eind = OPWARM + MEETDUUR;
  let gewist = false;
  while (sim.t < eind) {
    const tot = performance.now() + 25;
    while (sim.t < eind && performance.now() < tot) {
      stap(sim);
      if (!gewist && sim.t >= OPWARM) { sim.proefRitten.clear(); gewist = true; }
    }
    if (voortgang(sim.t / eind) === false) return null;
    await new Promise((r) => setTimeout(r, 0));
  }
  const uit = { meting: meting(sim, MEETDUUR), routes: {} };
  for (const p of sim.proeven) {
    const verwacht = zoekRoute(sim, p.van, p.naar);
    uit.routes[p.id] = { verwacht: verwacht?.tijd ?? null, ritten: (sim.proefRitten.get(p.id) ?? []).map((x) => x.tijd), lengte: verwacht ? padLengte(net, verwacht) : null };
  }
  return uit;
}

function padLengte(net, r) {
  return r.pad.reduce((a, li, k) => {
    const L = net.links[li];
    const van = k === 0 ? r.start.pos : 0, tot = k === r.pad.length - 1 ? r.doel.pos : L.len;
    return a + Math.max(0, tot - van);
  }, 0);
}
