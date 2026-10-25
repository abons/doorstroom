# Simulatie

- **Rijden**: IDM per auto per rijstrook, stap 0,25 s, geen inhalen binnen een strook. Rijstrook kiezen bij het
  oprijden van een link naar de volgende afslag (rechtsaf rechts, linksaf links, rechtdoor de rustigste). Geen
  rijstrookwissel op de link zelf (open werk). Gemeten capaciteit 1 strook: ~1370/u bij 30, ~1670/u bij 50,
  ~1800/u bij 80 km/u (2026-10-25).
- **Kruising**: oversteken is ogenblikkelijk; een afslag die net gereden is houdt conflicterende afslagen 0,9 s
  tegen, voorrangsgerechtigde 2 s (rotonde 1,4 s). Wijken voor naderende voorrangsauto's binnen 3 s (rotonde 2,5 s).
  Na 14 s wachten mag je een gat forceren (anders kan gelijkwaardig rechts-voor-links rondom vastlopen).
  Niet de kruising op als er achter de stopstreep geen plek is.
- **Conflict**: twee afslagen kruisen als hun koorden op een cirkel rond de knoop elkaar snijden; rechts rijden zit
  erin via een kleine hoekverschuiving (inkomend tegen de klok in, uitgaand met de klok mee). Samenvoegen naar
  dezelfde link is ook een conflict.
- **Voorrang**: hogere wegklasse gaat voor; gelijk → rechts gaat voor; rotonde-knoop → links gaat voor; tegenover
  elkaar → linksaf wijkt. OSM-rotondes (lussen) krijgen rang 10, dus invoegers wijken vanzelf.
- **VRI**: knopen met lichten die via wegvakken < 45 m samenhangen zijn één regelaar; tegenover elkaar liggende
  aanrijrichtingen delen een fase. ⚠️ **Verkeersafhankelijk** (min 6 s, max 30 s groen, 3 s geel, 2 s allesrood,
  door naar de volgende fase mét vraag): een vaste cyclus van 22 s gaf in de Amersfoort-demo 39 % doorstroom en
  liep op, verkeersafhankelijk ~65 % stabiel. Vrijwel elke Nederlandse VRI is verkeersafhankelijk.
- **Routes**: Dijkstra over links; kosten per afslag = gemeten tijd op de link bij vertrek via die afslag (EMA 0,15),
  start op lege-weg-tijd + afslagstraf; zonder metingen 60 s lang zakt de waarde terug naar leeg. Routes per
  herkomst/bestemming 120 s in de cache.
- **Doorstroom-%** = som lege-weg-tijd / som werkelijke tijd van afgeronde ritten (incl. wachten om het net op te komen).
- **Rotonde = echte ring** (2026-10-25, user: "Rotondes werken niet"). Eerst was een rotonde één knoop met "links gaat
  voor": alle bewegingen kruisten elkaar, auto's reden over het middeneiland en de capaciteit was die van een
  voorrangskruising (1695 vs 1659/u, kruis van primary-armen, drukte 1). Nu knipt `zetRegeling` (`maakRing` in
  `bewerk.js`) de armen op 14 m en legt eenrichtingsbogen tegen de klok in met `rotonde: true` — dezelfde vorm als een
  OSM-rotonde. Daarbij: aan de rand niet terug naar dezelfde weg (`terug` in `spawn`), anders gaf de ring ~20 % extra
  keer-ritten en was vóór/na niet vergelijkbaar. Een rotonde-knoop uit een oud scenario werkt nog als vroeger.
- **Rotonde om het hele kruispunt, 1-3 stroken, optioneel lichten** (2026-10-25, user: vier rotondejes op de
  Stadsring). `kruispuntVan`: knopen via wegvakken ≤ 25 m, ≤ 40 m van de aangeklikte (Stadsring × Van Asch van
  Wijckstraat: 5 knopen). Straal 14/20/26 m bij 1/2/3 stroken, minstens spreiding + 10. Demo, drukte 1, 2 seeds:
  basis (VRI) 57,8 %, ring 1 strook 64,3 %, 2 stroken 68,6 %, 3 stroken 68,3 % (geen strookwissel, dus 3 ≈ 2),
  3 + lichten 61,6 %. Met lichten: elke ingang een eigen regelaar (ring en ingang om beurten, `bouwRegelaars`
  loopt niet over ringlinks), straal ≥ 30 m en alleen de ring op bij ≤ 50 % ringbezetting (`ringVol`): zonder die
  twee liep een overvolle ring binnen 15 min helemaal vast (0 ritten/u).
