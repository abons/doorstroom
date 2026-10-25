# Open data

- **Google Maps valt af**: de voorwaarden verbieden gegevens uitlezen voor een eigen netwerk/simulatie.
- **Wegen: OpenStreetMap via Overpass** (`osm.js`): `highway`, `lanes`, `maxspeed`, `oneway`, `junction=roundabout`,
  `highway=traffic_signals`; wegen voor alleen bus/bestemming (`access`/`motor_vehicle`) vallen weg. Een weg loopt één
  knoop buiten het gebied door; die knoop wordt `rand` (in- en uitstroom). Antwoord in de Cache API.
- **Verkeerslichten**: OSM zet `traffic_signals` vaak op het aanrijvak; een kruising (3+ armen) met zo'n knoop binnen
  30 m wordt VRI. Voetgangerslichten (`crossing=*`) tellen niet mee.
- **Kaart, luchtfoto, zoeken: PDOK** (BRT grijs, Actueel_orthoHR, Locatieserver v3_1), CORS open, geen sleutel.
- **Vraag**: nu geschat — instroom aan de rand per rijstrook en wegklasse, lokale ritten naar weglengte
  (`RAND_PER_STROOK`, `LOKAAL_PER_KM` in `sim.js`). Een nieuwe weg krijgt geen lokale ritten (er staan geen huizen).
  BAG-panden en NDW-tellingen zijn open werk (`todo.md`).
- **Eerst de OSM-API via `serve.mjs` `/osm`, Overpass als terugval** (2026-10-25, user: "lang bezig met data ophalen").
  Overpass deed 30-40 s, ook een lege query (server vol); de OSM-API 1,3 s voor het demogebied, 3,3 s voor 2 × 2 km.
  De OSM-API geeft alles (11 MB voor het demogebied), dus de server knipt in tegels van 0,01° (te vol → vieren),
  filtert tot wegen + hun knopen + VRI-knopen (215 KB) en bewaart in `cache/`. Zelfde import, 466 vs 463 edges.
  ⚠️ De OSM-API is bedoeld voor bewerken: dit is laag volume met cache, niet voor een publieke versie.
  Overpass-servers gaan tegelijk (`Promise.any`), niet na elkaar.
