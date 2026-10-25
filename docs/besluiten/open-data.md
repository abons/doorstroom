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
