# doorstroom — signpost

"Fix traffic" on a real Dutch map: web PWA, vanilla ES modules, everything drawn on one `<canvas>`, no libraries,
no build. Dutch UI. Started 2026-10-25. Decisions: `design.md` → `docs/besluiten/`. Open work: `todo.md`.

| file | what |
| --- | --- |
| `web/net.js` | OSM → *kaart* (editable, plain JSON) and *kaart* → *simnet* (directed links, turns, conflicts, priority, signal groups); `vangPunt` snaps a click to both directions of a road |
| `web/sim.js` | the simulation (IDM per lane, gap acceptance, actuated signals, demand, `zoekRoute` Dijkstra on measured times, `meting`) — no DOM, runs in Node |
| `web/meet.js` | before/after measurement: fresh sims, 3 seeds × (10 min warm-up + 30 min), probe cars per route |
| `web/bewerk.js` | every edit mutates the *kaart* and returns a budget line; `kosten.js` holds the game cost figures |
| `web/teken.js` | renderer (PDOK tiles, roads, congestion colour, cars, lights, routes, selection) |
| `web/app.js` | UI glue: explore → load area → play; panel, tools, undo, save/restore (`ds-` localStorage keys) |
| `web/osm.js` | Overpass (3 endpoints in turn, Cache API), Locatieserver, tile URLs, `DEMO` |
| `web/demo/amersfoort.json` | OSM extract; the in-app demo **and** the real-data fixture of `test.mjs` |
| `test.mjs` | `node test.mjs` — run after any change to `net.js`/`sim.js`/`meet.js`/`bewerk.js` |
| `serve.mjs` | static server for `web/` on 127.0.0.1:**8095**; phone: `tailscale serve --bg --https=8447` → https://axel-pc.tailb59455.ts.net:8447 (tailnet only, never funnel; 2026-10-25) |

## Rules

- ⚠️ **Coordinates are local metres, x east, y SOUTH** (screen-like). Angles for turn geometry use `-dy`
  (`hoekWiskunde` in `net.js`); mixing the two flips left and right turns.
- ⚠️ **Before/after must stay comparable**: demand uses one random stream per origin keyed by the link *key*, not its
  index (common random numbers, `sim.js` `maakSim`). Anything that draws from a shared RNG inside `stap` breaks
  that. Single runs still differ a few % on no-op edits (measured 2026-10-25) → 3 seeds + `RUIS` thresholds.
- ⚠️ **Overpass is slow and flaky** (2026-10-25: 33 s for a 1.5 km² area; kumi/mail.ru mirrors timed out,
  overpass-api.de answers 406 to curl but works from a browser). Use the Demo for UI work.
- The live simulation runs on the main thread (`docs/besluiten/hoofdthread.md`); before/after measuring runs in `web/meet-worker.js` (a phone froze on it, 2026-10-25).
- Costs are game values (`kosten.js` header). Never present them as CROW figures or quotes.
- Service worker `web/sw.js` is network-first; bump `VERSIE` when the shell file list changes.
- Not Android: no emulator row. Testing on the phone means the browser — claim the device first.
