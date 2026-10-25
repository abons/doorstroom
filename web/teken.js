// Alles op één canvas: ondergrond (PDOK-tegels), wegen met doorstroomkleur, auto's, lichten, routes, selectie.
import { lon2tile, lat2tile, tile2lon, tile2lat, puntOp } from './geo.js';
import { STROOK } from './net.js';
import { lichtVoor } from './sim.js';
import { TEGELS } from './osm.js';

const tegelCache = new Map();
let opnieuw = () => {};
export const bijTegelGeladen = (f) => { opnieuw = f; };

function tegel(url) {
  let t = tegelCache.get(url);
  if (!t) {
    t = new Image(); t.crossOrigin = 'anonymous'; t.onload = () => opnieuw(); t.src = url;
    tegelCache.set(url, t);
    if (tegelCache.size > 600) tegelCache.delete(tegelCache.keys().next().value);
  }
  return t;
}

export const AUTOKLEUR = ['#e8e8e8', '#d94b3d', '#3d7fd9', '#f2c14e', '#5bb36a', '#9a6cd1'];
const kleurDoorstroom = (r) => (r > 0.75 ? '#3fb950' : r > 0.5 ? '#c9d23a' : r > 0.3 ? '#f0883e' : '#e5484d');

export function maakTekenaar(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { cx: 0, cy: 0, s: 0.5 }; // s = px per meter
  let W = 0, H = 0, dpr = 1;

  function maat() {
    dpr = Math.min(2, window.devicePixelRatio || 1); // 3× op telefoons kost veel en ziet er niet beter uit
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  const sx = (x) => (x - view.cx) * view.s + W / 2;
  const sy = (y) => (y - view.cy) * view.s + H / 2;
  const wereld = (px, py) => [(px - W / 2) / view.s + view.cx, (py - H / 2) / view.s + view.cy];

  function tegels(proj, laag) {
    const T = TEGELS[laag];
    if (!T) return;
    const [lat0] = proj.naarLL(view.cx, view.cy);
    let z = Math.round(Math.log2(156543.03392 * Math.cos((lat0 * Math.PI) / 180) * view.s * dpr * 0.9));
    z = Math.max(7, Math.min(T.max, z));
    const [latN, lonW] = proj.naarLL(...wereld(0, 0)), [latS, lonE] = proj.naarLL(...wereld(W, H));
    const x0 = Math.floor(lon2tile(lonW, z)), x1 = Math.floor(lon2tile(lonE, z));
    const y0 = Math.floor(lat2tile(latN, z)), y1 = Math.floor(lat2tile(latS, z));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 200) return;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const img = tegel(T.url(z, x, y));
      if (!img.complete || !img.naturalWidth) continue;
      const [ax, ay] = proj.naarXY(tile2lat(y, z), tile2lon(x, z)), [bx, by] = proj.naarXY(tile2lat(y + 1, z), tile2lon(x + 1, z));
      const px = sx(ax), py = sy(ay);
      ctx.drawImage(img, Math.floor(px), Math.floor(py), Math.ceil(sx(bx) - px) + 1, Math.ceil(sy(by) - py) + 1);
    }
  }

  // Polylijn met verschuiving d meter naar rechts (rijrichting), in schermcoördinaten.
  function pad(pts, d = 0) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      let nx = 0, ny = 0;
      if (d) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        nx = (-dy / l) * d; ny = (dx / l) * d;
      }
      const x = sx(pts[i][0] + nx), y = sy(pts[i][1] + ny);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
  }

  const baanVerschuiving = (L, baan) => (L.eenrichting ? ((L.lanes - 1) / 2 - baan) * STROOK : (L.lanes - baan - 0.5) * STROOK);

  function teken(st) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = st.laag === 'luchtfoto' ? '#1b1f1a' : '#e9ecef';
    ctx.fillRect(0, 0, W, H);
    if (st.proj) tegels(st.proj, st.laag);
    const { net, kaart, sim } = st;
    // Gebied buiten de bbox dimmen.
    if (kaart?.grens) {
      const g = kaart.grens;
      ctx.fillStyle = 'rgba(10,14,20,0.35)';
      ctx.beginPath(); ctx.rect(0, 0, W, H);
      ctx.rect(sx(g[0]), sy(g[1]), (g[2] - g[0]) * view.s, (g[3] - g[1]) * view.s);
      ctx.fill('evenodd');
    }
    if (!net) { tekenKader(st); return; }
    const s = view.s;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // Asfalt
    for (const e of Object.values(kaart.edges)) {
      const breed = Math.max(2.5, (e.lanesF + e.lanesB) * STROOK * s);
      pad(e.pts);
      ctx.strokeStyle = e.nieuw ? '#4a5a78' : st.laag === 'luchtfoto' ? 'rgba(40,44,52,0.85)' : '#5b6270';
      ctx.lineWidth = breed + (s > 1 ? 2 : 0); ctx.stroke();
    }
    // Doorstroom per rijrichting
    if (st.overlay) {
      for (const L of net.links) {
        const breed = Math.max(1.2, L.lanes * STROOK * s * 0.55);
        const d = L.eenrichting ? 0 : (L.lanes * STROOK) / 2;
        pad(L.pts, d);
        ctx.strokeStyle = kleurDoorstroom(L.snelheid ?? 1);
        ctx.globalAlpha = s > 2 ? 0.35 : 0.85;
        ctx.lineWidth = breed; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // Middenstreep bij inzoomen
    if (s > 2.5) {
      ctx.setLineDash([3 * s, 6 * s]); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = Math.max(1, 0.15 * s);
      for (const e of Object.values(kaart.edges)) if (e.lanesF && e.lanesB) { pad(e.pts); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    // Rotondes (als knoopregeling) en VRI-knopen
    for (const N of net.nodes) {
      if (N.ctrl === 'rotonde') {
        ctx.beginPath(); ctx.arc(sx(N.x), sy(N.y), Math.max(5, 9 * s), 0, 7);
        ctx.fillStyle = '#5bb36a'; ctx.fill(); ctx.lineWidth = Math.max(2, 4 * s); ctx.strokeStyle = '#5b6270'; ctx.stroke();
      }
    }
    // Lichten bij de stopstreep
    if (s > 0.35) {
      const p = [0, 0, 0];
      for (const L of net.links) {
        if (L.regelaar == null) continue;
        const l = lichtVoor(sim, L.i);
        puntOp(L.pts, L.cum, L.len - 1, p);
        const d = (L.eenrichting ? (L.lanes * STROOK) / 2 : L.lanes * STROOK) + 1.5;
        const x = p[0] - Math.sin(p[2]) * d, y = p[1] + Math.cos(p[2]) * d;
        ctx.beginPath(); ctx.arc(sx(x), sy(y), Math.max(2.5, 1.6 * s), 0, 7);
        ctx.fillStyle = l === 'groen' ? '#3fb950' : l === 'geel' ? '#f2c14e' : '#e5484d';
        ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#111'; ctx.stroke();
      }
    }
    // Routes
    for (const r of st.routes ?? []) {
      if (r.pad) {
        ctx.lineWidth = Math.max(3, 2 * s); ctx.strokeStyle = r.kleur; ctx.globalAlpha = 0.9;
        for (const li of r.pad) { const L = net.links[li]; if (L) { pad(L.pts, L.eenrichting ? 0 : (L.lanes * STROOK) / 2); ctx.stroke(); } }
        ctx.globalAlpha = 1;
      }
      if (r.padVoor && st.toonVoor) {
        ctx.setLineDash([6, 6]); ctx.lineWidth = Math.max(2, 1.2 * s); ctx.strokeStyle = '#ffffff';
        for (const L of r.padVoor) { pad(L.pts, L.d); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      speld(r.A, 'A', r.kleur); if (r.B) speld(r.B, 'B', r.kleur);
    }
    // Auto's
    const p = [0, 0, 0];
    const groot = s > 1.6;
    for (const L of net.links) {
      for (let b = 0; b < L.banen.length; b++) {
        const off = baanVerschuiving(L, b);
        for (const a of L.banen[b]) {
          puntOp(L.pts, L.cum, a.x - 2.2, p);
          const c = Math.cos(p[2]), si = Math.sin(p[2]);
          const x = sx(p[0] - si * off), y = sy(p[1] + c * off);
          const kleur = a.proef != null ? '#ffffff' : AUTOKLEUR[a.kleur];
          if (!groot) { const r = a.proef != null ? 4 : Math.max(2, 1.4 * s); ctx.fillStyle = '#0d1117'; ctx.fillRect(x - r - 0.8, y - r - 0.8, 2 * r + 1.6, 2 * r + 1.6); ctx.fillStyle = kleur; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); continue; }
          ctx.save(); ctx.translate(x, y); ctx.rotate(p[2]);
          ctx.fillStyle = kleur; ctx.fillRect(-2.2 * s, -0.9 * s, 4.4 * s, 1.8 * s);
          ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0.2 * s, -0.75 * s, 1.1 * s, 1.5 * s);
          if (a.proef != null) { ctx.strokeStyle = '#1f6feb'; ctx.lineWidth = 2; ctx.strokeRect(-2.2 * s, -0.9 * s, 4.4 * s, 1.8 * s); }
          if (a.v < 0.5 && s > 3) { ctx.fillStyle = '#ff3b30'; ctx.fillRect(-2.2 * s, -0.85 * s, 0.3 * s, 0.4 * s); ctx.fillRect(-2.2 * s, 0.45 * s, 0.3 * s, 0.4 * s); }
          ctx.restore();
        }
      }
    }
    // Selectie
    if (st.selectie?.soort === 'weg') {
      const e = kaart.edges[st.selectie.id];
      if (e) {
        pad(e.pts); ctx.strokeStyle = '#1f6feb'; ctx.lineWidth = Math.max(4, (e.lanesF + e.lanesB) * STROOK * s + 6); ctx.globalAlpha = 0.45; ctx.stroke(); ctx.globalAlpha = 1;
        pijl(e.pts, '#1f6feb');
      }
    }
    if (st.selectie?.soort === 'knoop') {
      const n = kaart.nodes[st.selectie.id];
      if (n) { ctx.beginPath(); ctx.arc(sx(n.x), sy(n.y), Math.max(10, 14 * s), 0, 7); ctx.strokeStyle = '#1f6feb'; ctx.lineWidth = 3; ctx.stroke(); }
    }
    if (st.markeerBeweging) {
      const m = st.markeerBeweging, A = net.links[m.from], Bl = net.links[m.to];
      const kort = (pts, eind) => { const out = []; let len = 0; const lijst = eind ? [...pts].reverse() : pts; for (let i = 0; i < lijst.length; i++) { out.push(lijst[i]); if (i) len += Math.hypot(lijst[i][0] - lijst[i - 1][0], lijst[i][1] - lijst[i - 1][1]); if (len > 30) break; } return eind ? out.reverse() : out; };
      const pts = [...kort(A.pts, true), ...kort(Bl.pts, false)];
      pad(pts, A.eenrichting ? 0 : STROOK / 2); ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 5; ctx.stroke();
      pijl(pts, '#f2c14e');
    }
    // Weg in aanleg
    if (st.tekenLijn?.length) {
      const pts = [...st.tekenLijn, ...(st.muis ? [st.muis] : [])];
      pad(pts); ctx.strokeStyle = 'rgba(31,111,235,0.8)'; ctx.lineWidth = Math.max(4, 2 * STROOK * s); ctx.stroke();
      for (const q of st.tekenLijn) { ctx.beginPath(); ctx.arc(sx(q[0]), sy(q[1]), 5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); }
    }
    tekenKader(st);
  }

  function pijl(pts, kleur) {
    const n = pts.length, [ax, ay] = pts[n - 2], [bx, by] = pts[n - 1];
    const h = Math.atan2(by - ay, bx - ax), x = sx(bx), y = sy(by);
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x - 14 * Math.cos(h - 0.4), y - 14 * Math.sin(h - 0.4));
    ctx.lineTo(x - 14 * Math.cos(h + 0.4), y - 14 * Math.sin(h + 0.4));
    ctx.closePath(); ctx.fillStyle = kleur; ctx.fill();
  }

  function speld([x, y], letter, kleur) {
    const px = sx(x), py = sy(y);
    ctx.beginPath(); ctx.arc(px, py - 16, 11, 0, 7); ctx.fillStyle = kleur; ctx.fill();
    ctx.beginPath(); ctx.moveTo(px - 6, py - 10); ctx.lineTo(px, py); ctx.lineTo(px + 6, py - 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(letter, px, py - 16);
  }

  // Het kader dat geladen gaat worden (in verkenmodus).
  function tekenKader(st) {
    if (!st.kader) return;
    const [x0, y0, x1, y1] = st.kader;
    ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.strokeStyle = '#1f6feb';
    ctx.strokeRect(sx(x0), sy(y0), (x1 - x0) * view.s, (y1 - y0) * view.s);
    ctx.setLineDash([]);
  }

  return { view, maat, teken, wereld, sx, sy };
}
