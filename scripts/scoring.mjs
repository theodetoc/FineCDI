// Scoring à deux axes : le rôle (ce que je fais) et la mission (pourquoi).
// Une offre doit marquer sur les deux. Aucune dépendance, testable hors ligne.

export function normaliser(texte) {
  return (texte || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ");
}

const contient = (t, mot) => (mot ? t.includes(normaliser(mot)) : false);

function joursDepuis(dateISO) {
  if (!dateISO) return 999;
  const d = new Date(dateISO);
  return isNaN(d) ? 999 : Math.floor((Date.now() - d.getTime()) / 86400000);
}

const POIDS_TITRE = 3;

// Ce qui rend une offre hors d'atteinte, indépendamment de l'envie.
const EXIGENCES = [
  { motif: /(\d+)\s*(ans|annees)\s*(d'|d )?exper/i, libelle: "ans d'expérience demandés" },
  { motif: /bac\s*\+\s*5|master 2|ingenieur diplome/i, libelle: "Bac+5 exigé" },
  { motif: /anglais (courant|bilingue|professionnel)/i, libelle: "anglais courant" },
  { motif: /permis (b|c|d)\b.*(exige|obligatoire)/i, libelle: "permis exigé" },
];

export function scorer(offre, profil) {
  const titre = normaliser(offre.intitule);
  const corps = normaliser([offre.description, offre.appellationlibelle].join(" "));
  const tout = titre + " " + corps;
  const age = joursDepuis(offre.dateCreation);

  for (const mot of profil.veto || []) {
    if (contient(titre, mot)) {
      return { score: -999, touches: [], alertes: [`métier écarté : ${mot}`], age, exigences: [] };
    }
  }

  let score = 0;
  const touches = [];
  const alertes = [];

  // Axe 1 : le rôle. Il se lit dans le titre avant tout.
  let scoreRole = 0;
  for (const [mot, poids] of Object.entries(profil.roles || {})) {
    if (contient(titre, mot)) { scoreRole += poids * POIDS_TITRE; touches.push(`${mot} (titre)`); }
    else if (contient(corps, mot)) { scoreRole += poids; touches.push(mot); }
  }

  // Axe 2 : la mission. Elle vit dans la description, c'est normal.
  let scoreMission = 0;
  for (const [mot, poids] of Object.entries(profil.missions || {})) {
    if (contient(titre, mot)) { scoreMission += poids * 2; touches.push(`${mot} (titre)`); }
    else if (contient(corps, mot)) { scoreMission += poids; touches.push(mot); }
  }

  if (scoreRole === 0) {
    return { score: -999, touches, alertes: ["rôle absent"], age, exigences: [] };
  }

  score = scoreRole + scoreMission;
  if (scoreMission === 0) {
    score += profil.penaliteMissionAbsente ?? -20;
    alertes.push("aucune mission identifiée");
  }

  for (const [mot, poids] of Object.entries(profil.negatifs || {})) {
    if (contient(tout, mot)) { score += poids; alertes.push(mot); }
  }

  const bonus = profil.bonus || {};
  if (age <= 7) score += bonus.offreDeMoinsDe7Jours || 0;
  if ((profil.recherche?.communes || []).map((c) => c.code).includes(offre.lieuTravail?.commune)) {
    score += bonus.communePrioritaire || 0;
  }
  const tranche = offre.entreprise?.trancheEffectif || "";
  if (/^(0|1|2|3|4|5)\b/.test(tranche)) score += bonus.entrepriseDeMoinsDe250 || 0;

  // Ce qui reste à vérifier à l'œil : les conditions d'entrée.
  const exigences = [];
  for (const e of EXIGENCES) {
    const m = (offre.description || "").match(e.motif);
    if (m) exigences.push(m[1] ? `${m[1]} ${e.libelle}` : e.libelle);
  }

  return { score, touches, alertes, age, exigences, scoreRole, scoreMission };
}

export function strategie(offre) {
  const eff = parseEffectif(offre.entreprise?.trancheEffectif);
  if (eff === null) return { canal: "linkedin", note: "Effectif inconnu : repérer une personne avant tout appel." };
  if (eff < 20) return { canal: "telephone", note: "Petite structure : le standard mène souvent au décideur. Appeler avant 10h." };
  if (eff < 250) return { canal: "linkedin+mail", note: "Repérer un interlocuteur sur LinkedIn, puis mail nominatif sous 48h." };
  return { canal: "linkedin+candidature", note: "Grande structure : viser 4 à 5 profils proches des décisions RH pour du réseau, en parallèle de la candidature formelle." };
}

function parseEffectif(tranche) {
  if (!tranche) return null;
  const m = String(tranche).match(/(\d+)\s*(?:a|à|-)\s*(\d+)/i);
  if (m) return parseInt(m[2], 10);
  const seul = String(tranche).match(/(\d+)/);
  return seul ? parseInt(seul[1], 10) : null;
}
