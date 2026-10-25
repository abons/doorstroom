# Doorstroom

Fix the traffic in your own town. Pick a piece of the Netherlands on a real map, watch individual cars drive the real
road network, then change it — speed limits, lanes, one-way streets, traffic lights, roundabouts, banned turns, new
roads — and see what it does to travel times, next to an estimate of what it would cost and how long it would take.

A game first, inspired by the "fix traffic" moments in Cities: Skylines; the numbers aim to be plausible, not a
substitute for a traffic study.

## What it does

- **Real map**: road network from OpenStreetMap (through `serve.mjs` from the OSM API, else the Overpass API), background map and aerial photo from PDOK, address
  search via the PDOK Locatieserver. An area is at most 2 × 2 km. A built-in demo (Amersfoort city centre) works
  without any network call.
- **Micro-simulation**: every car is simulated per lane (Intelligent Driver Model), with Dutch priority rules
  (main road, priority to the right, roundabouts), vehicle-actuated traffic lights and route choice on measured
  travel times.
- **Editing**: speed, lanes per direction, one-way, close a road, junction control (priority / lights / roundabout),
  ban individual turns, draw new roads. Undo, reset, save/open a scenario as JSON.
- **Route planner**: click A and B; you get the expected travel time and the time a probe car actually drove, before
  and after your changes.
- **Before / after**: both situations are measured in fresh simulations under the same demand (three runs of 30
  simulated minutes each, averaged); differences within the noise are shown as "gelijk".
- **Budget**: each change adds a line with cost, construction weeks and preparation weeks (game values, order of
  magnitude, 2026 prices).

## Run it

Live: https://abons.github.io/doorstroom/ (GitHub Pages, deployed from `web/` on every push to `main`). There the
road data comes from Overpass, which can take up to a minute on a busy day; `serve.mjs` fetches it in seconds.

No build step and no dependencies. Serve `web/` with any static server, or:

```
node serve.mjs        # http://127.0.0.1:8095
node test.mjs         # simulation, routing and editing tests
```

## Data and licences

- Roads © OpenStreetMap contributors, ODbL.
- Background map: PDOK BRT-Achtergrondkaart (Kadaster), CC BY 4.0. Aerial photo: PDOK / Beeldmateriaal Nederland, CC BY 4.0.
- `web/demo/amersfoort.json` is an OpenStreetMap extract (ODbL).

No ads, no tracking.
