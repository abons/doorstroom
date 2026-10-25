// Controleert het netmodel, de simulatie, de routeplanner en de bewerkingen op kleine kunstmatige netten en op een
// stuk echt Amersfoort (web/demo/amersfoort.json). Gebruik: node test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importOsm, bouwSimnet, leegKaart, vangPunt, lengteVanEdge } from './web/net.js';
import { maakSim, stap, meting, zoekRoute, proefTijd, draaiTot } from './web/sim.js';
import { meetScenario } from './web/meet.js';
import * as B from './web/bewerk.js';
import { totaal } from './web/kosten.js';

let n = 0;
const test = async (naam, f) => { await f(); n++; console.log('ok', naam); };

// Kaart uit knopen {id: [x, y, ctrl]} en wegen [a, b, cls, kmh, lanesF, lanesB].
function maak(knopen, wegen) {
  const k = leegKaart(52, 5, [0, 0, 0, 0]);
  for (const [id, [x, y, ctrl]] of Object.entries(knopen)) k.nodes[id] = { id, x, y, ctrl: ctrl ?? 'voorrang' };
  wegen.forEach(([a, b, cls = 'secondary', kmh = 50, f = 1, bb = 1], i) => {
    k.edges['e' + i] = { id: 'e' + i, a, b, pts: [[k.nodes[a].x, k.nodes[a].y], [k.nodes[b].x, k.nodes[b].y]], cls, naam: `w${i}`, kmh, lanesF: f, lanesB: bb, rotonde: false };
  });
  return k;
}
// Kruispunt: centrum c, armen naar N/O/Z/W van 400 m die aan de rand eindigen. Noord-zuid is de hoofdweg.
const kruis = (ctrl = 'voorrang', nz = 'secondary', ow = 'secondary') => maak(
  { c: [0, 0, ctrl], n: [0, -400, 'rand'], o: [400, 0, 'rand'], z: [0, 400, 'rand'], w: [-400, 0, 'rand'] },
  [['z', 'c', nz], ['c', 'n', nz], ['w', 'c', ow], ['c', 'o', ow]],
);
const beweging = (net, van, naar) => net.moves.find((m) => net.links[m.from].from === net.nodes.findIndex((x) => x.id === van) && net.links[m.to].to === net.nodes.findIndex((x) => x.id === naar));

await test('afslagen en conflicten op een kruispunt', () => {
  const net = bouwSimnet(kruis('voorrang', 'secondary', 'residential'));
  const c = net.nodes.find((x) => x.id === 'c');
  assert.equal(c.moves.length, 12); // 4 armen × 3 (geen keren)
  const zn = beweging(net, 'z', 'n'), zw = beweging(net, 'z', 'w'), zo = beweging(net, 'z', 'o'), nz = beweging(net, 'n', 'z'), wo = beweging(net, 'w', 'o');
  assert.equal(zn.soort, 'S'); assert.equal(zw.soort, 'L'); assert.equal(zo.soort, 'R');
  assert.ok(zw.conflict.includes(nz.i), 'linksaf kruist tegemoetkomend rechtdoor');
  assert.ok(!zo.conflict.includes(nz.i), 'rechtsaf kruist tegemoetkomend rechtdoor niet');
  assert.ok(zn.conflict.includes(wo.i), 'rechtdoor kruist rechtdoor');
  assert.ok(wo.wijktVoor.includes(zn.i), 'zijweg wijkt voor hoofdweg');
  assert.ok(zw.wijktVoor.includes(nz.i), 'linksaf wijkt voor tegemoetkomend rechtdoor');
  // Gelijkwaardig: rechts gaat voor. Voor wie van west komt, komt zuid van rechts.
  const gelijk = bouwSimnet(kruis('voorrang', 'residential', 'residential'));
  assert.ok(beweging(gelijk, 'w', 'o').wijktVoor.includes(beweging(gelijk, 'z', 'n').i));
  // Rotonde: verkeer van links gaat voor, dus nu wijkt zuid voor west.
  const rot = bouwSimnet(kruis('rotonde', 'residential', 'residential'));
  assert.ok(beweging(rot, 'z', 'n').wijktVoor.includes(beweging(rot, 'w', 'o').i));
});

await test('lege weg: verwacht = gereden = lengte / snelheid', () => {
  const k = maak({ a: [0, 0, 'rand'], m: [0, 1000], b: [0, 2000, 'rand'] }, [['a', 'm'], ['m', 'b']]);
  const net = bouwSimnet(k);
  const sim = maakSim(net, { drukte: 0 });
  const A = vangPunt(net, 0, 200), Bp = vangPunt(net, 0, 1800);
  const r = zoekRoute(sim, A.plekken, Bp.plekken);
  const vrij = 1600 / (50 / 3.6);
  assert.ok(Math.abs(r.tijd - vrij) / vrij < 0.05, `verwacht ${r.tijd} vs ${vrij}`);
  sim.proeven = [{ id: 1, van: A.plekken, naar: Bp.plekken }];
  draaiTot(sim, 400);
  const gereden = proefTijd(sim, 1);
  assert.ok(gereden && Math.abs(gereden - vrij) / vrij < 0.06, `gereden ${gereden} vs ${vrij}`);
});

await test('capaciteit van één rijstrook ligt rond 1800-2200 per uur', () => {
  const k = maak({ a: [0, 0, 'rand'], b: [0, 1000, 'rand'] }, [['a', 'b', 'secondary', 50, 1, 0]]);
  const sim = maakSim(bouwSimnet(k), { drukte: 8 });
  draaiTot(sim, 1200);
  const m = meting(sim, 600);
  assert.ok(m.rittenPerUur > 1600 && m.rittenPerUur < 2500, `${m.rittenPerUur} per uur`);
});

await test('VRI: verkeersafhankelijk, wachttijd binnen redelijke grenzen', () => {
  const k = kruis('vri');
  const net = bouwSimnet(k);
  assert.equal(net.regelaars.length, 1);
  assert.equal(net.regelaars[0].fasen.length, 2);
  const sim = maakSim(net, { drukte: 0.5 });
  const A = vangPunt(net, 0, 350), Bp = vangPunt(net, 0, -350);
  sim.proeven = [{ id: 1, van: A.plekken, naar: Bp.plekken }];
  const tijden = [];
  for (let i = 0; i < 40; i++) { draaiTot(sim, sim.t + 60); const l = sim.proefRitten.get(1); if (l?.length) tijden.push(l.at(-1).tijd); sim.proefRitten.clear(); }
  const vrij = 700 / (50 / 3.6), gem = tijden.reduce((a, b) => a + b, 0) / tijden.length;
  // Hoogstens een volle cyclus van twee fasen (2 × (30 + 3 + 2) s), gemiddeld ruim minder; en er wordt wel eens gewacht.
  assert.ok(gem - vrij > 1 && gem - vrij < 25, `gemiddelde vertraging ${(gem - vrij).toFixed(1)} s`);
  assert.ok(Math.max(...tijden) - vrij < 75, `langste vertraging ${(Math.max(...tijden) - vrij).toFixed(1)} s`);
});

await test('raster van gelijkwaardige kruisingen loopt niet vast (1 uur)', () => {
  const knopen = {}, wegen = [];
  const N = 4, D = 150;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) knopen[`k${i}_${j}`] = [i * D, j * D];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (i + 1 < N) wegen.push([`k${i}_${j}`, `k${i + 1}_${j}`, 'residential', 30]);
    if (j + 1 < N) wegen.push([`k${i}_${j}`, `k${i}_${j + 1}`, 'residential', 30]);
  }
  for (let i = 0; i < N; i++) {
    knopen[`rn${i}`] = [i * D, -200, 'rand']; wegen.push([`rn${i}`, `k${i}_0`, 'residential', 30]);
    knopen[`rz${i}`] = [i * D, (N - 1) * D + 200, 'rand']; wegen.push([`k${i}_${N - 1}`, `rz${i}`, 'residential', 30]);
  }
  const sim = maakSim(bouwSimnet(maak(knopen, wegen)), { drukte: 3 });
  draaiTot(sim, 1200);
  const eerst = meting(sim, 600).rittenPerUur;
  draaiTot(sim, 3600);
  const laatst = meting(sim, 600).rittenPerUur;
  let vast = 0;
  for (const L of sim.net.links) for (const b of L.banen) for (const a of b) if (a.wacht > 120) vast++;
  assert.ok(eerst > 100 && laatst > eerst * 0.6, `ritten/uur ${eerst} -> ${laatst}`);
  assert.ok(vast < 5, `${vast} auto's staan al 2 min stil`);
});

const amersfoort = () => importOsm(JSON.parse(readFileSync(new URL('./web/demo/amersfoort.json', import.meta.url))), [52.150, 5.380, 52.160, 5.395]);

await test('Amersfoort: import, VRI\'s gevonden, 20 min verkeer', () => {
  const k = amersfoort();
  const net = bouwSimnet(k);
  assert.ok(Object.keys(k.edges).length > 300);
  assert.ok(net.nodes.filter((x) => x.ctrl === 'rand').length > 20);
  assert.ok(net.regelaars.length >= 5);
  const sim = maakSim(net);
  draaiTot(sim, 1200);
  const m = meting(sim, 600);
  assert.ok(m.rittenPerUur > 1000, `${m.rittenPerUur} ritten/uur`);
  assert.ok(m.doorstroom > 0.3 && m.doorstroom <= 1, `doorstroom ${m.doorstroom}`);
});

await test('bewerkingen: knippen, weg tekenen, afsluiten, kosten', () => {
  const k = maak({ a: [0, 0, 'rand'], b: [0, 1000, 'rand'], c: [500, 500, 'rand'] }, [['a', 'b']]);
  const voor = lengteVanEdge(k.edges.e0);
  const r = B.tekenWeg(k, [[0, 500], [500, 500]], { cls: 'tertiary', kmh: 50 });
  assert.ok(r && r.kosten > 0 && r.bouwWeken > 0);
  assert.equal(Object.keys(k.edges).length, 3, 'oude weg geknipt in twee + de nieuwe');
  const som = Object.values(k.edges).filter((e) => !e.nieuw).reduce((a, e) => a + lengteVanEdge(e), 0);
  assert.ok(Math.abs(som - voor) < 0.01);
  const nieuw = Object.values(k.edges).find((e) => e.nieuw);
  assert.equal(nieuw.b, 'c', 'eind haakt aan de bestaande knoop');
  const net = bouwSimnet(k);
  const midden = net.nodes.find((x) => x.id === nieuw.a);
  assert.equal(midden.arms.length, 3);
  assert.equal(B.zetSnelheid(k, nieuw.id, 50), null, 'geen wijziging = geen regel');
  const s = B.zetSnelheid(k, nieuw.id, 30);
  assert.ok(s.kosten > 0 && /50 → 30/.test(s.omschrijving));
  const v = B.zetRegeling(k, midden.id, 'vri');
  assert.ok(v.kosten >= 100000);
  const t = totaal([r, s, v]);
  assert.equal(t.kosten, r.kosten + s.kosten + v.kosten);
  assert.equal(t.voorbereidingWeken, Math.max(r.voorbereidingWeken, s.voorbereidingWeken, v.voorbereidingWeken));
  B.verwijderWeg(k, nieuw.id);
  assert.ok(!Object.values(k.edges).some((e) => e.nieuw));
  assert.ok(!k.nodes.c, 'losse knoop opgeruimd');
});

await test('rotonde wordt een ring: tegen de klok in, wijkt bij oprijden, beter dan voorrang bij drukte', () => {
  const k = kruis('voorrang', 'primary', 'primary');
  const v = B.zetRegeling(k, 'c', 'rotonde');
  assert.ok(v.kosten >= 500000 && v.voorbereidingWeken > 26);
  assert.ok(!k.nodes.c, 'middelpunt weg');
  const ring = Object.values(k.edges).filter((e) => e.rotonde);
  assert.equal(ring.length, 4);
  for (const e of ring) {
    assert.equal(e.lanesB, 0);
    const [a, b] = [k.nodes[e.a], k.nodes[e.b]];
    assert.ok(a.x * -b.y - -a.y * b.x > 0, 'tegen de klok in (y wijst naar het zuiden)');
  }
  assert.equal(B.zetRegeling(k, ring[0].a, 'rotonde'), null, 'geen ring in een ring');
  const net = bouwSimnet(k);
  const op = net.moves.find((m) => !net.links[m.from].rotonde && net.links[m.to].rotonde);
  assert.ok(op.wijktVoor.length > 0, 'oprijden wijkt voor de ring');
  const ritten = (kk) => { const sim = maakSim(bouwSimnet(kk), { drukte: 1, seed: 7 }); draaiTot(sim, 1800); return meting(sim, 1200).rittenPerUur; };
  const rr = ritten(k), vr = ritten(kruis('voorrang', 'primary', 'primary'));
  assert.ok(rr >= vr * 0.98, `ring ${rr} vs voorrang ${vr} per uur`);
});

await test('rotonde op gescheiden rijbanen: één ring om alle vier de knopen, lichten per ingang', () => {
  // Twee wegen met gescheiden rijbanen (eenrichting, 12 m uit elkaar) kruisen: vier knopen in een vierkant.
  const k = maak(
    { a: [-6, -6, 'vri'], b: [6, -6, 'vri'], c: [6, 6, 'vri'], d: [-6, 6, 'vri'],
      n1: [-6, -400, 'rand'], n2: [6, -400, 'rand'], z1: [-6, 400, 'rand'], z2: [6, 400, 'rand'],
      w1: [-400, -6, 'rand'], w2: [-400, 6, 'rand'], o1: [400, -6, 'rand'], o2: [400, 6, 'rand'] },
    [['n1', 'a', 'primary', 50, 2, 0], ['a', 'd', 'primary', 50, 2, 0], ['d', 'z1', 'primary', 50, 2, 0],
     ['z2', 'c', 'primary', 50, 2, 0], ['c', 'b', 'primary', 50, 2, 0], ['b', 'n2', 'primary', 50, 2, 0],
     ['o1', 'b', 'primary', 50, 2, 0], ['b', 'a', 'primary', 50, 2, 0], ['a', 'w1', 'primary', 50, 2, 0],
     ['w2', 'd', 'primary', 50, 2, 0], ['d', 'c', 'primary', 50, 2, 0], ['c', 'o2', 'primary', 50, 2, 0]],
  );
  assert.deepEqual(B.kruispuntVan(k, 'a').sort(), ['a', 'b', 'c', 'd']);
  assert.equal(B.standaardStroken(k, 'a'), 2);
  const r = B.maakRotonde(k, 'a', { stroken: 2, lichten: true });
  assert.ok(/2 stroken met verkeerslichten/.test(r.omschrijving) && r.kosten > 1000000);
  const ring = Object.values(k.edges).filter((e) => e.rotonde);
  assert.equal(ring.length, 8, 'acht armen, acht ringdelen');
  assert.ok(ring.every((e) => e.lanesF === 2));
  assert.equal(Object.values(k.nodes).filter((n) => n.ctrl === 'vri').length, 4, 'licht alleen bij de vier ingangen');
  const net = bouwSimnet(k);
  assert.equal(net.regelaars.length, 4, 'elke ingang een eigen regelaar');
  const sim = maakSim(net, { drukte: 1, seed: 7 });
  draaiTot(sim, 1800);
  assert.ok(meting(sim, 1200).rittenPerUur > 1000, 'verkeer komt erdoor');
});

await test('afslagverbod: route kiest een andere weg', () => {
  // Ladder: van linksonder naar rechtsboven kan via twee kruisingen.
  const k = maak(
    { a: [0, 400, 'rand'], p: [0, 0], q: [0, -300], r: [300, 0], s: [300, -300], b: [600, -300, 'rand'] },
    [['a', 'p', 'tertiary'], ['p', 'q', 'tertiary'], ['p', 'r', 'tertiary'], ['q', 's', 'tertiary'], ['r', 's', 'tertiary'], ['s', 'b', 'tertiary']],
  );
  const net = bouwSimnet(k);
  const sim = maakSim(net, { drukte: 0 });
  const A = vangPunt(net, 0, 300), Z = vangPunt(net, 550, -300);
  const r1 = zoekRoute(sim, A.plekken, Z.plekken);
  const eerste = net.links[r1.pad[1]];
  const m = net.moves.find((x) => x.from === r1.pad[0] && x.to === r1.pad[1]);
  B.wisselVerbod(k, m.key, 'test');
  const net2 = bouwSimnet(k), sim2 = maakSim(net2, { drukte: 0 });
  const r2 = zoekRoute(sim2, vangPunt(net2, 0, 300).plekken, vangPunt(net2, 550, -300).plekken);
  assert.notEqual(net2.links[r2.pad[1]].edge, eerste.edge);
});

await test('scenario meten: vóór en na met dezelfde seed geven hetzelfde', async () => {
  const k = kruis('voorrang');
  const routes = [{ id: 1, A: [0, 350], B: [0, -350] }];
  const a = await meetScenario(k, routes, { drukte: 1 });
  const b = await meetScenario(structuredClone(k), routes, { drukte: 1 });
  assert.deepEqual(a, b);
  assert.ok(a.routes[1].verwacht > 0 && a.routes[1].gereden > 0);
});

console.log(`${n} tests geslaagd`);
