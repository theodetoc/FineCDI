// Scoring déterministe d'une offre France Travail contre profil.json.
// Aucune dépendance, aucun appel réseau, aucune clé : testable hors ligne.

export function normaliser(texte) {
  return (texte || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ");
}

function contient(texte, aiguille) {
  const a = normaliser(aiguille);
  return a ? texte.includes(a) : false;
}

function joursDepuis(dateISO) {
  if (!dateISO) return 999;
  const d = new Date(dateISO);
  if (isNaN(d)) return 999;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

const POIDS_INTITULE = 3; // le titre dit le métier, la description dit l'ambiance

export function scorer(offre, profil) {
  const titre = normaliser(offre.intitule);
  const corps = normaliser([offre.description, offre.appellationlibelle].join(" "));
  const age = joursDepuis(offre.dateCreation);

  // Veto : un métier qui n'est pas le vôtre ne se rattrape pas au score.
  for (const mot of profil.veto || []) {
    if (contient(titre, mot)) {
      return { score: -999, touches: [], alertes: [`métier écarté : ${mot}`], age };
    }
  }

  let score = 0;
  const touches = [];
  const alertes = [];

  for (const [mot, poids] of Object.entries(profil.positifs || {})) {
    if (contient(titre, mot)) {
      score += poids * POIDS_INTITULE;
      touches.push(`${mot} (titre)`);
    } else if (contient(corps, mot)) {
      score += poids;
      touches.push(mot);
    }
  }

  for (const [mot, poids] of Object.entries(profil.negatifs || {})) {
    if (contient(titre, mot) || contient(corps, mot)) {
      score += poids;
      alertes.push(mot);
    }
  }

  const bonus = profil.bonus || {};
  if (age <= 7) score += bonus.offreDeMoinsDe7Jours || 0;

  const codesCommunes = (profil.recherche?.communes || []).map((c) => c.code);
  if (codesCommunes.includes(offre.lieuTravail?.commune)) score += bonus.communePrioritaire || 0;

  if ((profil.recherche?.codesROME || []).includes(offre.romeCode)) score += bonus.romeCible || 0;

  const tranche = offre.entreprise?.trancheEffectif || "";
  if (/^(0|1|2|3|4|5)\b/.test(tranche) || /moins de 250/i.test(tranche)) {
    score += bonus.entrepriseDeMoinsDe250 || 0;
  }

  return { score, touches, alertes, age };
}

/** Canal recommandé, par règles. L'effectif décide, pas l'intuition. */
export function strategie(offre) {
  const eff = parseEffectif(offre.entreprise?.trancheEffectif);
  if (eff === null) return { canal: "linkedin", note: "Effectif inconnu : repérer une personne avant tout appel." };
  if (eff < 20) return { canal: "telephone", note: "Petite structure : le standard mène souvent au décideur. Appeler avant 10h." };
  if (eff < 250) return { canal: "linkedin+mail", note: "Repérer un interlocuteur sur LinkedIn, puis mail nominatif sous 48h." };
  return {
    canal: "linkedin+candidature",
    note: "Grande structure : viser 4 à 5 profils proches des décisions RH pour du réseau, en parallèle de la candidature formelle.",
  };
}

function parseEffectif(tranche) {
  if (!tranche) return null;
  const m = String(tranche).match(/(\d+)\s*(?:a|à|-)\s*(\d+)/i);
  if (m) return parseInt(m[2], 10);
  const seul = String(tranche).match(/(\d+)/);
  return seul ? parseInt(seul[1], 10) : null;
}
