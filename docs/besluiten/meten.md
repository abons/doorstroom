# Vóór/na meten

- Vóór = de kaart zoals geladen, na = met alle wijzigingen; elk in een **verse** simulatie: 10 min opwarmen, 30 min
  meten, één proefauto per route per minuut. Niet de lopende (zichtbare) simulatie: die is na elke bewerking leeg.
- ⚠️ **Gemeenschappelijk toeval**: elke herkomst trekt uit een eigen stroom, geseed op `seed + linksleutel`, en trekt
  elke stap precies twee getallen. Zonder dat lagen vier seeds van dezelfde kaart tussen 53 en 66 % doorstroom.
- ⚠️ **Ook dan is verkeer chaotisch**: een wijziging zonder effect (wegvak knippen) gaf per seed −0 tot −4 %
  (2026-10-25). Dus 3 seeds gemiddeld, en verschillen onder `RUIS` (2 %-punt doorstroom, 3 % reistijd) heten
  "gelijk". Duur: ~3 s per scenario voor de demo.
- Route: *verwacht* = Dijkstra op de gemeten tijden aan het eind; *gereden* = mediaan van alle proefritten.
