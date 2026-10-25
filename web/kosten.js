// Kengetallen per ingreep. ⚠️ Spelwaarden: ordegrootte prijspeil 2026, eigen schatting (2026-10-25), géén
// CROW-tabel of offerte. Voorbereiding = ontwerp + besluit (verkeersbesluit ~8 wk incl. bezwaartermijn, groter werk
// meer); bouw = uitvoering. Bij meerdere ingrepen loopt voorbereiding parallel en bouw na elkaar.
export const KENGETAL = {
  bord: 350,                 // € per verkeersbord incl. plaatsen
  verkeersbesluit: 8,        // weken
  drempelPer150m: 8000,      // € plateau/drempel bij 30 km/u of lager
  strookErbijPerM: 900,     // € per m per extra rijstrook (verbreden, fundering, kolken, kabels/leidingen gemiddeld)
  strookErbijMPerWeek: 30,
  strookEraf: 40,            // € per m herbelijnen
  afsluiten: 6000,
  afslagverbod: 1500,
  vriNieuw: 180000, vriWeg: 30000,
  rotonde: 850000, rotondeWeg: 250000,
  nieuweWegPerM: 1400,       // € per m, 2×1 strook incl. riolering en verlichting
  nieuweWegStrookPerM: 600,  // € per m per strook extra
  nieuweWegMPerWeek: 25,
};
const K = KENGETAL;

const regel = (omschrijving, kosten, bouwWeken, voorbereidingWeken) => ({ omschrijving, kosten: Math.round(kosten / 100) * 100, bouwWeken, voorbereidingWeken });

export function kostSnelheid(naam, lengte, richtingen, oud, nieuw) {
  const borden = 2 * richtingen * Math.max(1, Math.ceil(lengte / 500));
  let k = borden * K.bord, bouw = 1;
  if (nieuw <= 30 && oud > 30) { const n = Math.max(1, Math.round(lengte / 150)); k += n * K.drempelPer150m; bouw += Math.ceil(n / 4); }
  return regel(`${naam}: ${oud} → ${nieuw} km/u`, k, bouw, K.verkeersbesluit);
}

export function kostStroken(naam, lengte, oudTot, nieuwTot) {
  if (nieuwTot > oudTot) {
    const m = lengte * (nieuwTot - oudTot);
    return regel(`${naam}: ${oudTot} → ${nieuwTot} rijstroken`, m * K.strookErbijPerM, Math.max(2, Math.ceil(m / K.strookErbijMPerWeek)), 26);
  }
  return regel(`${naam}: ${oudTot} → ${nieuwTot} rijstroken`, lengte * K.strookEraf, 1, K.verkeersbesluit);
}

export const kostRichting = (naam, wat) => regel(`${naam}: ${wat}`, 6 * K.bord + 400, 1, K.verkeersbesluit);
export const kostAfsluiten = (naam) => regel(`${naam}: afgesloten voor auto's`, K.afsluiten, 1, K.verkeersbesluit);
export const kostAfslag = (wat, aan) => regel(`${aan ? 'Afslag weer toegestaan' : 'Afslagverbod'}: ${wat}`, aan ? 2 * K.bord : K.afslagverbod, 1, K.verkeersbesluit);

export function kostRegeling(naam, oud, nieuw) {
  const t = `${naam}: ${NAAM_REGELING[oud]} → ${NAAM_REGELING[nieuw]}`;
  if (nieuw === 'vri') return regel(t, K.vriNieuw + (oud === 'rotonde' ? K.rotondeWeg : 0), 6 + (oud === 'rotonde' ? 8 : 0), 26);
  if (nieuw === 'rotonde') return regel(t, K.rotonde + (oud === 'vri' ? K.vriWeg : 0), 14, 39);
  if (oud === 'vri') return regel(t, K.vriWeg, 2, K.verkeersbesluit);
  if (oud === 'rotonde') return regel(t, K.rotondeWeg, 8, 26);
  return regel(t, 0, 0, 0);
}
export const NAAM_REGELING = { voorrang: 'voorrangskruising', vri: 'verkeerslichten', rotonde: 'rotonde', rand: 'rand' };

export function kostNieuweWeg(lengte, strokenTot) {
  const k = lengte * (K.nieuweWegPerM + Math.max(0, strokenTot - 2) * K.nieuweWegStrookPerM);
  return regel(`Nieuwe weg, ${Math.round(lengte)} m`, k, Math.max(4, Math.ceil(lengte / K.nieuweWegMPerWeek)), 52);
}

// Totaal over een lijst regels.
export function totaal(regels) {
  return {
    kosten: regels.reduce((a, r) => a + r.kosten, 0),
    bouwWeken: regels.reduce((a, r) => a + r.bouwWeken, 0),
    voorbereidingWeken: regels.reduce((a, r) => Math.max(a, r.voorbereidingWeken), 0),
  };
}

export const euro = (n) => '€ ' + Math.round(n).toLocaleString('nl-NL');
