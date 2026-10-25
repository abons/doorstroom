# Platform: web-PWA

2026-10-25, user (keuze uit Web/PWA, Android, desktop). Gemeentes werken op desktop; op een telefoon tekenen is krap;
de Android-familieregel "geen libraries, alles zelf" maakt een kaart op Android veel werk.

- Vanilla ES-modules, geen build, geen libraries — wel in de geest van de familie: kaart, wegen en auto's zijn zelf
  getekend op één canvas (geen Leaflet/MapLibre). Tegels komen als plaatjes van PDOK.
- Zelfde stramien als `Kinderwoordjes`/`superaanbieding`: statische pagina + klein `serve.mjs` (poort 8095).
- Doel: eerst een spel (user: "spel eerst"); kosten en tijd globaal realistisch.
