// De pagina: verkennen (kaart, gebied kiezen) en spelen (simulatie, bewerken, routes, vóór/na, begroting).
import { maakProjectie } from './geo.js';
import { importOsm, bouwSimnet, vangPunt, klasseVan, lengteVanEdge } from './net.js';
import { maakSim, stap, meting, zoekRoute, DT } from './sim.js';
import { maakTekenaar, bijTegelGeladen } from './teken.js';
import { haalWegen, zoekAdres, TEGELS, DEMO } from './osm.js';
import { meetScenario, proevenVoor, RUIS, SEEDS } from './meet.js';
import * as B from './bewerk.js';
import { totaal, euro, NAAM_REGELING } from './kosten.js';

const $ = (id) => document.getElementById(id);
const doek = $('doek');
const T = maakTekenaar(doek);
const view = T.view;

const lees = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const schrijf = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

const plek = lees('ds-plek') ?? { lat: 52.1561, lon: 5.3878, s: 0.5 };
const st = {
  proj: maakProjectie(plek.lat, plek.lon), laag: lees('ds-laag') ?? 'kaart', overlay: true,
  kaart: null, net: null, sim: null, routes: [], selectie: null, kader: null, tekenLijn: null, muis: null, markeerBeweging: null,
};
view.s = plek.s;
let basis = null, begroting = [], historie = [], tool = 'kijk', lopend = true, tempo = 1, drukte = 1, opwarmen = false;
let voor = null, na = null, meetGen = 0, meetVoortgang = null, wegSoort = 0;
const ROUTEKLEUR = ['#1f6feb', '#d29922', '#a371f7', '#3fb950', '#f778ba'];
const WEGSOORTEN = [
  { naam: 'Woonstraat 30', cls: 'residential', kmh: 30, stroken: 1 },
  { naam: 'Wijkweg 50', cls: 'tertiary', kmh: 50, stroken: 1 },
  { naam: 'Hoofdweg 50, 2×2', cls: 'secondary', kmh: 50, stroken: 2 },
  { naam: 'Autoweg 80, 2×2', cls: 'trunk', kmh: 80, stroken: 2 },
];

// ---------- hulpjes ----------
const mmss = (s) => { if (s == null) return '–'; const r = Math.round(s); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; };
const pct = (x) => `${Math.round(x * 100)}%`;
let meldTimer;
function meld(tekst, ms = 0) {
  const m = $('melding');
  m.hidden = !tekst; m.textContent = tekst ?? '';
  clearTimeout(meldTimer);
  if (ms && tekst) meldTimer = setTimeout(() => { m.hidden = true; }, ms);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- modus ----------
function spelModus(aan) {
  $('paneel').hidden = !aan;
  document.body.classList.toggle('met-paneel', aan);
  $('simKnoppen').hidden = !aan; $('drukteVak').hidden = !aan;
  $('laad').hidden = aan; $('demo').hidden = aan;
  kop();
}

function huidigKader() {
  const [x0, y0] = T.wereld(0, 0), [x1, y1] = T.wereld(doek.clientWidth, doek.clientHeight);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const w = Math.min((x1 - x0) * 0.85, 2000), h = Math.min((y1 - y0) * 0.85, 2000);
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}

async function laadGebied() {
  const [x0, y0, x1, y1] = huidigKader();
  if (x1 - x0 < 150 || y1 - y0 < 150) { meld('Zoom wat verder uit: het gebied is te klein.', 3000); return; }
  if (view.s < 0.12) { meld('Zoom verder in: een gebied is hoogstens 2 × 2 km.', 3000); return; }
  const [n, w] = st.proj.naarLL(x0, y0), [s, e] = st.proj.naarLL(x1, y1);
  $('laad').disabled = true;
  try {
    const osm = await haalWegen([s, w, n, e], (t) => meld(t));
    const kaart = importOsm(osm, [s, w, n, e]);
    if (Object.keys(kaart.edges).length < 3) throw new Error('Hier liggen (bijna) geen wegen voor auto’s.');
    begin(kaart, { routes: [], begroting: [], basis: JSON.stringify(kaart) });
    meld('');
  } catch (err) {
    meld(`Laden mislukt: ${err.message}. Probeer het later nog eens, of kies Demo.`, 10000);
  } finally { $('laad').disabled = false; }
}

async function laadDemo() {
  try {
    const osm = await (await fetch(DEMO.url)).json();
    const kaart = importOsm(osm, DEMO.bbox);
    st.proj = maakProjectie(kaart.lat0, kaart.lon0); view.cx = 0; view.cy = 0; view.s = 0.75;
    begin(kaart, { routes: [], begroting: [], basis: JSON.stringify(kaart) });
  } catch (err) { meld(`Demo laden mislukt: ${err.message}`, 5000); }
}

function begin(kaart, { routes, begroting: bg, basis: b, historie: h = [] }) {
  // De projectie van de kaart wordt leidend; het beeld blijft op dezelfde plek staan.
  const [lat, lon] = st.proj.naarLL(view.cx, view.cy);
  st.proj = maakProjectie(kaart.lat0, kaart.lon0);
  [view.cx, view.cy] = st.proj.naarXY(lat, lon);
  st.kaart = kaart; st.routes = routes; basis = b; begroting = bg; historie = h;
  st.selectie = null; st.kader = null; voor = null; na = null;
  spelModus(true);
  bouw();
  kiesTool('kijk');
  planMeting(true);
  paneel();
  bewaar();
}

function verkennen() {
  st.kaart = null; st.net = null; st.sim = null; st.routes = []; st.selectie = null; basis = null;
  try { localStorage.removeItem('ds-scenario'); } catch {}
  spelModus(false);
}

// ---------- simulatie ----------
function bouw() {
  const net = bouwSimnet(st.kaart);
  const sim = maakSim(net, { drukte, seed: (Math.random() * 1e9) | 0 });
  sim.proeven = proevenVoor(net, st.routes);
  st.net = net; st.sim = sim;
  // Even laten vollopen, zodat je niet naar een lege stad kijkt.
  opwarmen = true;
  const doel = 240;
  const warm = () => {
    if (st.sim !== sim) return;
    const tot = performance.now() + 20;
    while (sim.t < doel && performance.now() < tot) stap(sim);
    if (sim.t < doel) setTimeout(warm, 0); else opwarmen = false;
  };
  warm();
  routesLive();
}

let laatst = performance.now(), rest = 0, paneelTijd = 0, routeTijd = 0;
function lus(nu) {
  const dt = Math.min(0.1, (nu - laatst) / 1000);
  laatst = nu;
  const { sim } = st;
  if (sim && lopend && !opwarmen) {
    rest += dt * tempo;
    const tot = performance.now() + 12;
    while (rest >= DT && performance.now() < tot) { stap(sim); rest -= DT; }
    if (rest > 2) rest = 0;
  }
  if (!st.net) st.kader = huidigKader();
  T.teken(st);
  if (nu - paneelTijd > 500) { paneelTijd = nu; score(); }
  if (sim && nu - routeTijd > 2000) { routeTijd = nu; routesLive(); }
  requestAnimationFrame(lus);
}

function score() {
  const { sim } = st;
  if (!sim) return;
  const m = meting(sim, 300);
  const d = $('doorstroom');
  d.textContent = sim.ritten.length ? pct(m.doorstroom) : '–';
  d.style.color = m.doorstroom > 0.75 ? 'var(--goed)' : m.doorstroom > 0.5 ? '#c9d23a' : m.doorstroom > 0.3 ? 'var(--let)' : 'var(--slecht)';
  $('autos').textContent = m.autos;
  $('reistijd').textContent = mmss(m.gemReistijd);
  $('verlies').textContent = m.verliesPerUur.toFixed(1);
  const t = sim.start + sim.t;
  $('klok').textContent = `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;
  if (st.selectie?.soort === 'weg') liveWeg();
}

function routesLive() {
  const { sim, net } = st;
  if (!sim) return;
  for (const r of st.routes) {
    const p = sim.proeven.find((x) => x.id === r.id);
    const z = p && zoekRoute(sim, p.van, p.naar);
    r.pad = z?.pad ?? null; r.live = z?.tijd ?? null;
    const el = document.querySelector(`[data-live="${r.id}"]`);
    if (el) el.textContent = mmss(r.live);
  }
  void net;
}

// Vóór (de kaart zoals geladen) en na (met de wijzigingen) meten, elk in een eigen verse simulatie.
let meetTimer;
function planMeting(ookVoor = false) {
  if (ookVoor) voor = null;
  clearTimeout(meetTimer);
  meetTimer = setTimeout(meetAlles, 500);
}
// Meten in een worker (module-worker); waar dat niet kan op de hoofdthread in brokjes.
let werker = null;
function meetLos(kaart, routes, opties, voortgang) {
  werker?.terminate(); werker = null;
  let w;
  try { w = new Worker('meet-worker.js', { type: 'module' }); } catch { return meetScenario(kaart, routes, opties, voortgang); }
  werker = w;
  return new Promise((klaar) => {
    w.onmessage = ({ data }) => {
      if (data.f != null) { if (voortgang(data.f) === false) { w.terminate(); klaar(null); } return; }
      w.terminate(); if (werker === w) werker = null; klaar(data.klaar);
    };
    w.onerror = (e) => { e.preventDefault(); w.terminate(); klaar(meetScenario(kaart, routes, opties, voortgang)); };
    w.postMessage({ kaart, routes, opties });
  });
}

async function meetAlles() {
  const gen = ++meetGen;
  const routes = st.routes.filter((r) => r.B).map((r) => ({ id: r.id, A: r.A, B: r.B }));
  const opties = { drukte };
  const toon = (wat) => (f) => { if (gen !== meetGen) return false; meetVoortgang = { wat, f }; meetStatus(); };
  if (!voor) {
    const v = await meetLos(JSON.parse(basis), routes, opties, toon('vóór'));
    if (gen !== meetGen || !v) return;
    voor = v;
  }
  if (begroting.length) {
    const n = await meetLos(st.kaart, routes, opties, toon('na'));
    if (gen !== meetGen || !n) return;
    na = n;
  } else na = null;
  meetVoortgang = null;
  meetStatus(); vergelijk(); routesPaneel();
}
function meetStatus() {
  $('meetStatus').innerHTML = meetVoortgang ? `${meetVoortgang.wat} meten… ${Math.round(meetVoortgang.f * 100)}%` : voor ? `gemiddelde van ${SEEDS.length} × 30 min verkeer` : '';
}

// ---------- bewerken ----------
function bewerk(f) {
  const kopie = JSON.stringify(st.kaart);
  const regel = f(st.kaart);
  if (!regel) return;
  historie.push({ kaart: kopie, begroting: [...begroting], selectie: st.selectie });
  begroting.push(regel);
  na = null;
  if (st.selectie?.soort === 'weg' && !st.kaart.edges[st.selectie.id]) st.selectie = null;
  if (st.selectie?.soort === 'knoop' && !st.kaart.nodes[st.selectie.id]) st.selectie = null;
  bouw(); planMeting(); paneel(); bewaar();
}
function ongedaan() {
  const h = historie.pop();
  if (!h) return;
  st.kaart = JSON.parse(h.kaart); begroting = h.begroting; st.selectie = h.selectie;
  if (st.selectie && !(st.selectie.soort === 'weg' ? st.kaart.edges : st.kaart.nodes)[st.selectie.id]) st.selectie = null;
  na = null;
  bouw(); planMeting(); paneel(); bewaar();
}
function allesTerug() {
  if (!begroting.length) return;
  historie.push({ kaart: JSON.stringify(st.kaart), begroting: [...begroting], selectie: st.selectie });
  st.kaart = JSON.parse(basis); begroting = []; st.selectie = null; na = null;
  bouw(); planMeting(); paneel(); bewaar();
}

// ---------- paneel ----------
function paneel() {
  selectiePaneel(); routesPaneel(); vergelijk(); begrotingPaneel(); meetStatus();
  $('ongedaan').disabled = !historie.length; $('allesTerug').disabled = !begroting.length;
}

function kiesTool(t) {
  tool = t; st.tekenLijn = null;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('aan', b.dataset.tool === t));
  doek.classList.toggle('tekenen', t !== 'kijk');
  uitleg();
}

function uitleg() {
  const u = $('uitleg');
  if (tool === 'weg') {
    u.innerHTML = `<div class="kiezer">${WEGSOORTEN.map((w, i) => `<button data-wegsoort="${i}" class="${i === wegSoort ? 'aan' : ''}">${w.naam}</button>`).join('')}</div>
      Klik punten op de kaart; begin en eind haken aan een weg of kruising. Klik nog eens op het laatste punt (of Enter) om af te ronden, Esc om te stoppen.
      ${st.tekenLijn?.length > 1 ? `<div class="rij" style="margin-top:6px"><button id="wegKlaar" class="klein aan">Weg aanleggen</button><button id="wegStop" class="klein">Stoppen</button></div>` : ''}`;
  } else if (tool === 'route') {
    const open = st.routes.find((r) => !r.B);
    u.textContent = open ? 'Klik nu punt B (bestemming).' : st.routes.length >= 5 ? 'Maximaal 5 routes; verwijder er eerst een.' : 'Klik punt A (vertrek) op een weg.';
  } else u.textContent = st.selectie ? '' : 'Klik op een weg of kruising om hem aan te passen. Slepen = schuiven, scrollen = zoomen.';
}

const SOORT = { S: 'rechtdoor', L: 'linksaf', R: 'rechtsaf', U: 'keren' };
const windrichting = (h) => ['oosten', 'noordoosten', 'noorden', 'noordwesten', 'westen', 'zuidwesten', 'zuiden', 'zuidoosten'][Math.round(((h * 180) / Math.PI + 360) / 45) % 8];

function selectiePaneel() {
  const el = $('selectie');
  const { kaart, net } = st;
  const sel = st.selectie;
  uitleg();
  if (!sel || !kaart) { el.innerHTML = ''; return; }
  if (sel.soort === 'weg') {
    const e = kaart.edges[sel.id];
    const len = Math.round(lengteVanEdge(e));
    const r = B.richting(e);
    el.innerHTML = `<h2>${esc(e.naam || 'Naamloze weg')} <small>${klasseVan(e.cls).naam} · ${len} m</small></h2>
      <h3>Maximumsnelheid</h3>
      <div class="kiezer">${[15, 30, 50, 60, 80, 100].map((v) => `<button data-kmh="${v}" class="${v === e.kmh ? 'aan' : ''}">${v}</button>`).join('')}</div>
      <h3>Rijstroken <small>(pijl op de kaart = richting →)</small></h3>
      <span class="teller">→ <button data-strook="F-">−</button><b>${e.lanesF}</b><button data-strook="F+">+</button></span>
      <span class="teller">← <button data-strook="B-">−</button><b>${e.lanesB}</b><button data-strook="B+">+</button></span>
      <h3>Richting</h3>
      <div class="kiezer">${[['beide', 'Beide kanten'], ['heen', 'Alleen →'], ['terug', 'Alleen ←']].map(([k, t]) => `<button data-richting="${k}" class="${k === r ? 'aan' : ''}">${t}</button>`).join('')}</div>
      <div class="rij" style="margin-top:8px"><button id="afsluiten" class="klein">Afsluiten voor auto's</button></div>
      <p class="stil" id="liveWeg"></p>`;
    liveWeg();
  } else {
    const n = kaart.nodes[sel.id];
    const N = net.nodes.find((x) => x.id === sel.id);
    const namen = [...new Set(Object.values(kaart.edges).filter((e) => e.a === n.id || e.b === n.id).map((e) => e.naam).filter(Boolean))];
    const naamLink = (li) => net.links[li].naam || klasseVan(net.links[li].cls).naam.toLowerCase();
    const afslagen = [
      ...N.moves.map((mi) => ({ ...net.moves[mi], toegestaan: true })),
      ...N.verboden.map((v) => ({ ...v, toegestaan: false })),
    ].sort((a, b) => a.hIn - b.hIn || a.soort.localeCompare(b.soort));
    el.innerHTML = `<h2>${esc(namen.join(' / ') || 'Kruising')}</h2>
      ${n.ctrl === 'rand' ? '<p class="stil">Rand van het gebied: hier rijdt verkeer in en uit.</p>' : `
      <h3>Regeling</h3>
      <div class="kiezer">${['voorrang', 'vri', ...(n.ctrl === 'rotonde' ? ['rotonde'] : [])].map((c) => `<button data-ctrl="${c}" class="${c === n.ctrl ? 'aan' : ''}">${NAAM_REGELING[c][0].toUpperCase() + NAAM_REGELING[c].slice(1)}</button>`).join('')}</div>
      ${rotondeKeuze(kaart, n.id)}
      <h3>Afslagen <small>(vinkje uit = verboden)</small></h3>
      ${afslagen.map((m) => `<label class="afslag" data-afslag="${m.key}" data-tekst="${esc(`${naamLink(m.from)} → ${naamLink(m.to)} (${SOORT[m.soort]})`)}">
        <input type="checkbox" ${m.toegestaan ? 'checked' : ''}> uit het ${windrichting(m.hIn)}: ${esc(naamLink(m.from))} → ${esc(naamLink(m.to))}<span class="soort">${SOORT[m.soort]}</span></label>`).join('')}`}`;
  }
}

// Rotonde bouwen rond het hele kruispunt (alle knopen op een paar meter van elkaar), met 1-3 stroken op de ring.
function rotondeKeuze(kaart, id) {
  if (Object.values(kaart.edges).some((e) => (e.a === id || e.b === id) && e.rotonde)) return '<p class="stil">Ligt aan een rotonde.</p>';
  const leden = B.kruispuntVan(kaart, id).length, std = B.standaardStroken(kaart, id);
  return `<h3>Rotonde maken</h3>
      ${leden > 1 ? `<p class="stil">Neemt het hele kruispunt mee (${leden} knopen).</p>` : ''}
      <div class="kiezer">${[1, 2, 3].map((s) => `<button data-rotonde="${s}" class="${s === std ? 'aan' : ''}">${s} ${s > 1 ? 'stroken' : 'strook'}</button>`).join('')}</div>
      <label class="stil"><input type="checkbox" id="rotLicht"> met verkeerslichten bij elke ingang</label>`;
}

function liveWeg() {
  const el = $('liveWeg');
  if (!el || !st.net) return;
  const ls = st.net.links.filter((L) => L.edge === st.selectie.id);
  el.textContent = 'Nu: ' + ls.map((L) => `${L.dir === 'f' ? '→' : '←'} ${L.aantal ?? 0} auto's, ${pct(L.snelheid ?? 1)} van max`).join(' · ');
}

function vergelijk() {
  const t = $('vergelijk');
  if (!voor) { t.innerHTML = '<tr><td class="stil">Wordt gemeten…</td></tr>'; return; }
  const v = voor.meting, n = na?.meting;
  const rij = (naam, a, b, fmt, hogerBeter, ruis) => {
    let d = '';
    if (b != null) {
      const diff = b - a, goed = hogerBeter ? diff > 0 : diff < 0;
      const klein = Math.abs(diff) <= ruis(a);
      d = klein ? '<span>gelijk</span>' : `<span class="${goed ? 'beter' : 'slechter'}">${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}</span>`;
    }
    return `<tr><td>${naam}</td><td>${fmt(a)}</td><td>${b == null ? '–' : fmt(b)}</td><td>${d}</td></tr>`;
  };
  t.innerHTML = `<tr><th></th><th>Vóór</th><th>Na</th><th>Verschil</th></tr>
    ${rij('Doorstroom', v.doorstroom, n?.doorstroom, pct, true, () => RUIS.doorstroom)}
    ${rij('Gem. rit', v.gemReistijd, n?.gemReistijd, mmss, false, (x) => Math.max(2, x * RUIS.reistijd))}
    ${rij('Verliesuren / uur', v.verliesPerUur, n?.verliesPerUur, (x) => x.toFixed(1), false, (x) => Math.max(0.3, x * 0.08))}
    ${rij('Ritten / uur', v.rittenPerUur, n?.rittenPerUur, (x) => Math.round(x), true, (x) => x * 0.02)}
    ${!begroting.length ? '<tr><td colspan="4" class="stil">Nog niets veranderd: pas een weg of kruising aan.</td></tr>' : ''}`;
}

function routesPaneel() {
  const el = $('routes');
  if (!st.routes.length) { el.innerHTML = '<p class="stil">Kies ⚑ Route en klik A en B op de kaart.</p>'; return; }
  el.innerHTML = st.routes.map((r) => {
    const a = voor?.routes[r.id], b = na?.routes[r.id];
    const delta = (x, y) => (x == null || y == null ? '' : Math.abs(y - x) <= Math.max(3, x * RUIS.reistijd) ? 'gelijk' : `<span class="${y < x ? 'beter' : 'slechter'}">${y < x ? '−' : '+'}${mmss(Math.abs(y - x))}</span>`);
    return `<div class="route"><div class="kop"><span class="stip" style="background:${r.kleur}"></span>
      <input data-routenaam="${r.id}" value="${esc(r.naam)}"><button class="klein" data-weg="${r.id}" title="Verwijderen">×</button></div>
      ${r.B ? `<div class="tijden"><span></span><b>Vóór</b><b>Na</b><b>Verschil</b>
        <span>Verwacht</span><span>${mmss(a?.verwacht)}</span><span>${b ? mmss(b.verwacht) : '–'}</span><span>${delta(a?.verwacht, b?.verwacht)}</span>
        <span>Gereden</span><span>${mmss(a?.gereden)}</span><span>${b ? mmss(b.gereden) : '–'}</span><span>${delta(a?.gereden, b?.gereden)}</span></div>
        <p class="stil">Nu (live): <b data-live="${r.id}">${mmss(r.live)}</b>${a?.lengte ? ` · ${(a.lengte / 1000).toFixed(1)} km` : ''}${b?.lengte && a?.lengte && Math.abs(b.lengte - a.lengte) > 30 ? ` → ${(b.lengte / 1000).toFixed(1)} km (ander pad)` : ''}</p>`
        : '<p class="stil">Klik punt B op de kaart.</p>'}</div>`;
  }).join('');
}

function begrotingPaneel() {
  const t = $('begroting');
  if (!begroting.length) { t.innerHTML = '<tr><td class="stil">Nog geen wijzigingen.</td></tr>'; return; }
  const tot = totaal(begroting);
  t.innerHTML = `<tr><th>Ingreep</th><th>Kosten</th><th>Bouw</th></tr>
    ${begroting.map((r) => `<tr><td>${esc(r.omschrijving)}</td><td>${euro(r.kosten)}</td><td>${r.bouwWeken} wk</td></tr>`).join('')}
    <tr class="totaal"><td>Totaal</td><td>${euro(tot.kosten)}</td><td>${tot.bouwWeken} wk</td></tr>
    <tr><td colspan="3" class="stil">Voorbereiding ~${tot.voorbereidingWeken} wk (besluit, ontwerp; loopt parallel), uitvoering ~${tot.bouwWeken} wk → klaar na ~${tot.voorbereidingWeken + tot.bouwWeken} weken.</td></tr>`;
}

// ---------- klikken op de kaart ----------
function klik(px, py) {
  const [x, y] = T.wereld(px, py);
  if (!st.net) return;
  if (tool === 'kijk') {
    st.selectie = raak(px, py);
    st.markeerBeweging = null;
    selectiePaneel();
  } else if (tool === 'weg') {
    const lijn = st.tekenLijn ?? [];
    const p = vangTeken(px, py);
    const laatste = lijn[lijn.length - 1];
    if (laatste && Math.hypot(T.sx(laatste[0]) - px, T.sy(laatste[1]) - py) < 8) { legWegAan(); return; }
    lijn.push(p); st.tekenLijn = lijn; uitleg();
  } else if (tool === 'route') {
    const v = vangPunt(st.net, x, y, 25 / view.s + 10);
    if (!v) { meld('Klik op een weg.', 2000); return; }
    let r = st.routes.find((q) => !q.B);
    if (!r) {
      if (st.routes.length >= 5) return;
      const id = Math.max(0, ...st.routes.map((q) => q.id)) + 1;
      r = { id, naam: `Route ${id}`, A: [v.x, v.y], B: null, kleur: ROUTEKLEUR[(id - 1) % ROUTEKLEUR.length] };
      st.routes.push(r);
    } else {
      r.B = [v.x, v.y];
      st.sim.proeven = proevenVoor(st.net, st.routes);
      routesLive();
      planMeting(true);
      bewaar();
    }
    uitleg(); routesPaneel();
  }
}

// Wat ligt er onder de muis? Kruisingen (3+ armen, VRI, rotonde) gaan voor wegen.
function raak(px, py) {
  const { kaart, net } = st;
  let best = null, bd = 16;
  for (const N of net.nodes) {
    if (N.arms.length < 3 && N.ctrl === 'voorrang') continue;
    const d = Math.hypot(T.sx(N.x) - px, T.sy(N.y) - py);
    if (d < bd) { bd = d; best = { soort: 'knoop', id: N.id }; }
  }
  if (best) return best;
  const [x, y] = T.wereld(px, py);
  const v = vangPunt(net, x, y, 14 / view.s);
  if (v) return { soort: 'weg', id: v.edge };
  void kaart;
  return null;
}

// Punt voor de nieuwe weg; haakt aan een knoop of weg in de buurt (in pixels gemeten).
function vangTeken(px, py) {
  const [x, y] = T.wereld(px, py);
  let best = null, bd = 14;
  for (const n of Object.values(st.kaart.nodes)) { const d = Math.hypot(T.sx(n.x) - px, T.sy(n.y) - py); if (d < bd) { bd = d; best = [n.x, n.y]; } }
  if (best) return best;
  const v = vangPunt(st.net, x, y, 12 / view.s);
  return v ? [v.x, v.y] : [x, y];
}

function legWegAan() {
  const lijn = st.tekenLijn;
  st.tekenLijn = null;
  if (!lijn || lijn.length < 2) { uitleg(); return; }
  const w = WEGSOORTEN[wegSoort];
  bewerk((k) => B.tekenWeg(k, lijn, { cls: w.cls, kmh: w.kmh, stroken: w.stroken, vang: 14 / view.s }));
  uitleg();
}

// ---------- invoer ----------
const wijzers = new Map();
let sleep = null, knijp = null;
doek.addEventListener('pointerdown', (ev) => {
  doek.setPointerCapture(ev.pointerId);
  wijzers.set(ev.pointerId, [ev.offsetX, ev.offsetY]);
  if (wijzers.size === 1) sleep = { x: ev.offsetX, y: ev.offsetY, cx: view.cx, cy: view.cy, bewogen: false };
  if (wijzers.size === 2) {
    const [a, b] = [...wijzers.values()];
    knijp = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: view.s }; sleep = null;
  }
});
doek.addEventListener('pointermove', (ev) => {
  if (st.tekenLijn) { st.muis = T.wereld(ev.offsetX, ev.offsetY); }
  if (!wijzers.has(ev.pointerId)) { hover(ev.offsetX, ev.offsetY); return; }
  wijzers.set(ev.pointerId, [ev.offsetX, ev.offsetY]);
  if (knijp && wijzers.size === 2) {
    const [a, b] = [...wijzers.values()];
    zoomOm((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (knijp.s * Math.hypot(a[0] - b[0], a[1] - b[1])) / knijp.d / view.s);
  } else if (sleep) {
    const dx = ev.offsetX - sleep.x, dy = ev.offsetY - sleep.y;
    if (Math.hypot(dx, dy) > 5) sleep.bewogen = true;
    if (sleep.bewogen) { view.cx = sleep.cx - dx / view.s; view.cy = sleep.cy - dy / view.s; }
  }
});
const los = (ev) => {
  if (sleep && !sleep.bewogen && wijzers.size === 1) klik(ev.offsetX, ev.offsetY);
  wijzers.delete(ev.pointerId);
  if (wijzers.size < 2) knijp = null;
  if (!wijzers.size) { sleep = null; bewaarPlek(); }
};
doek.addEventListener('pointerup', los);
doek.addEventListener('pointercancel', (ev) => { wijzers.delete(ev.pointerId); sleep = null; knijp = null; });
doek.addEventListener('wheel', (ev) => { ev.preventDefault(); zoomOm(ev.offsetX, ev.offsetY, Math.exp(-ev.deltaY * 0.0015)); bewaarPlek(); }, { passive: false });

function zoomOm(px, py, f) {
  const [x, y] = T.wereld(px, py);
  view.s = Math.max(0.02, Math.min(12, view.s * f));
  const [x2, y2] = T.wereld(px, py);
  view.cx += x - x2; view.cy += y - y2;
}

function hover(px, py) {
  if (tool !== 'kijk' || !st.net) return;
  doek.style.cursor = raak(px, py) ? 'pointer' : '';
}

let plekTimer;
function bewaarPlek() {
  clearTimeout(plekTimer);
  plekTimer = setTimeout(() => { const [lat, lon] = st.proj.naarLL(view.cx, view.cy); schrijf('ds-plek', { lat, lon, s: view.s }); }, 400);
}

function bewaar() {
  if (!st.kaart) return;
  const ok = schrijf('ds-scenario', { versie: 1, basis, kaart: st.kaart, begroting, routes: st.routes.map(({ id, naam, A, B: b, kleur }) => ({ id, naam, A, B: b, kleur })), drukte });
  if (!ok) try { localStorage.removeItem('ds-scenario'); } catch {}
}

// Knoppen in het paneel (één luisteraar).
$('paneel').addEventListener('click', (ev) => {
  const b = ev.target.closest('button, label.afslag');
  if (!b) return;
  const sel = st.selectie, d = b.dataset;
  if (d.tool) kiesTool(d.tool);
  else if (d.wegsoort) { wegSoort = +d.wegsoort; uitleg(); }
  else if (b.id === 'wegKlaar') legWegAan();
  else if (b.id === 'wegStop') { st.tekenLijn = null; uitleg(); }
  else if (d.kmh) bewerk((k) => B.zetSnelheid(k, sel.id, +d.kmh));
  else if (d.strook) {
    const e = st.kaart.edges[sel.id], f = d.strook[0] === 'F', dd = d.strook[1] === '+' ? 1 : -1;
    bewerk((k) => B.zetStroken(k, sel.id, e.lanesF + (f ? dd : 0), e.lanesB + (f ? 0 : dd)));
  } else if (d.richting) bewerk((k) => B.zetRichting(k, sel.id, d.richting));
  else if (b.id === 'afsluiten') bewerk((k) => B.verwijderWeg(k, sel.id));
  else if (d.ctrl) bewerk((k) => B.zetRegeling(k, sel.id, d.ctrl));
  else if (d.rotonde) { const lichten = $('rotLicht')?.checked; bewerk((k) => B.maakRotonde(k, sel.id, { stroken: +d.rotonde, lichten })); }
  else if (d.afslag) { ev.preventDefault(); bewerk((k) => B.wisselVerbod(k, d.afslag, d.tekst)); }
  else if (d.weg) {
    st.routes = st.routes.filter((r) => r.id !== +d.weg);
    if (st.sim) st.sim.proeven = proevenVoor(st.net, st.routes);
    routesPaneel(); uitleg(); bewaar();
  }
  else if (b.id === 'ongedaan') ongedaan();
  else if (b.id === 'allesTerug') allesTerug();
  else if (b.id === 'meet') planMeting(true);
  else if (b.id === 'exporteer') exporteer();
  else if (b.id === 'anderGebied') verkennen();
});
$('paneel').addEventListener('mouseover', (ev) => {
  const a = ev.target.closest('[data-afslag]');
  const key = a?.dataset.afslag;
  st.markeerBeweging = key ? st.net.moves.find((m) => m.key === key) ?? st.net.nodes.flatMap((n) => n.verboden).find((m) => m.key === key) : null;
});
$('paneel').addEventListener('input', (ev) => {
  const id = ev.target.dataset.routenaam;
  if (id) { const r = st.routes.find((q) => q.id === +id); if (r) { r.naam = ev.target.value; bewaar(); } }
});

$('laad').onclick = laadGebied;
$('demo').onclick = laadDemo;
$('speel').onclick = () => { lopend = !lopend; $('speel').textContent = lopend ? '⏸' : '▶'; };
document.querySelectorAll('[data-tempo]').forEach((b) => (b.onclick = () => {
  tempo = +b.dataset.tempo;
  document.querySelectorAll('[data-tempo]').forEach((x) => x.classList.toggle('aan', x === b));
}));
$('drukte').oninput = (ev) => {
  drukte = +ev.target.value; $('drukteTekst').textContent = pct(drukte);
  if (st.sim) st.sim.drukte = drukte;
};
$('drukte').onchange = () => { planMeting(true); bewaar(); };
$('laag').value = st.laag;
$('laag').onchange = (ev) => { st.laag = ev.target.value; schrijf('ds-laag', st.laag); bron(); };
function bron() { $('bron').textContent = `Wegen © OpenStreetMap-bijdragers (ODbL)${TEGELS[st.laag] ? ' · ' + TEGELS[st.laag].bron : ''}`; }

document.addEventListener('keydown', (ev) => {
  if (ev.target.matches('input, select, textarea')) return;
  if (ev.key === ' ' && st.sim) { ev.preventDefault(); $('speel').click(); }
  else if (ev.key === '1' && st.net) kiesTool('kijk');
  else if (ev.key === '2' && st.net) kiesTool('weg');
  else if (ev.key === '3' && st.net) kiesTool('route');
  else if (ev.key === 'Escape') { st.tekenLijn = null; st.selectie = null; st.routes = st.routes.filter((r) => r.B); selectiePaneel(); routesPaneel(); }
  else if (ev.key === 'Enter' && st.tekenLijn) legWegAan();
  else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z') { ev.preventDefault(); ongedaan(); }
});

// Zoeken
let zoekTimer, resultaten = [];
$('zoek').addEventListener('input', (ev) => {
  clearTimeout(zoekTimer);
  const q = ev.target.value.trim();
  if (q.length < 2) { $('zoekLijst').hidden = true; return; }
  zoekTimer = setTimeout(async () => {
    try { resultaten = await zoekAdres(q); } catch { resultaten = []; }
    const l = $('zoekLijst');
    l.innerHTML = resultaten.map((r, i) => `<li data-i="${i}">${esc(r.naam)}<small>${r.type}</small></li>`).join('');
    l.hidden = !resultaten.length;
  }, 250);
});
$('zoek').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && resultaten[0]) ga(resultaten[0]); });
$('zoekLijst').addEventListener('click', (ev) => { const li = ev.target.closest('li'); if (li) ga(resultaten[+li.dataset.i]); });
function ga(r) {
  $('zoekLijst').hidden = true; $('zoek').value = r.naam; $('zoek').blur();
  if (st.net) verkennen();
  st.proj = maakProjectie(r.lat, r.lon); view.cx = 0; view.cy = 0;
  view.s = { gemeente: 0.08, woonplaats: 0.15, weg: 0.5, postcode: 0.5, adres: 0.7 }[r.type] ?? 0.4;
  bewaarPlek();
}

function exporteer() {
  const data = { versie: 1, basis, kaart: st.kaart, begroting, routes: st.routes.map(({ id, naam, A, B: b, kleur }) => ({ id, naam, A, B: b, kleur })), drukte };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `doorstroom-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('importeer').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  try { herstel(JSON.parse(await f.text())); } catch (e) { meld(`Kan dit bestand niet openen: ${e.message}`, 4000); }
  ev.target.value = '';
});
function herstel(d) {
  if (!d?.kaart || !d.basis) throw new Error('geen scenario');
  drukte = d.drukte ?? 1; $('drukte').value = drukte; $('drukteTekst').textContent = pct(drukte);
  begin(d.kaart, { routes: d.routes ?? [], begroting: d.begroting ?? [], basis: d.basis });
}

// ---------- start ----------
// Hoogte van de bovenbalk (loopt op een telefoon over meerdere regels) bepaalt waar kaart en paneel beginnen.
function kop() { document.documentElement.style.setProperty('--kop', $('balk').offsetHeight + 'px'); T.maat(); }
window.addEventListener('resize', kop);
document.querySelector('.score').addEventListener('click', () => { if (innerWidth <= 760) { document.body.classList.toggle('paneel-klein'); T.maat(); } });
bijTegelGeladen(() => {});
kop(); bron();
const vorig = lees('ds-scenario');
if (vorig) { try { herstel(vorig); } catch { verkennen(); } } else spelModus(false);
requestAnimationFrame(lus);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
