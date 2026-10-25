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
