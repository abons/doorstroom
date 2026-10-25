# Simulatie op de hoofdthread

Het plan zei WebWorker. Gedaan zonder: 30 min simtijd van de Amersfoort-demo (~630 links, ~200 auto's) kost ~1 s in
Node, dus 1–16× realtime past ruim in een frame (budget 12 ms per frame), en metingen lopen in brokken van 25 ms.
Een worker kost dubbele netbouw en berichten per frame. Terug naar een worker als een 2×2 km-gebied met spits haperingen geeft.
