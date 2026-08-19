// Collecte des offres France Travail, scoring, écriture de data/offres.json.
// Tourne dans GitHub Actions. Les secrets ne quittent jamais le runner.
//
//   FT_CLIENT_ID / FT_CLIENT_SECRET  -> GitHub Secrets
//
// Node >= 20 (fetch natif), zéro dépendance npm.

import { readFile, writeFile } from "node:fs/promises";
import { scorer, strategie } from "./scoring.mjs";

const TOKEN_URL =
  "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const API = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
const API_DETAIL = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/";
const MAX_DETAILS = 40; // on ne consulte le détail que des offres qui valent le coup
const SCOPE = "api_offresdemploiv2 o2dsoffre";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function jeton() {
  const corps = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.FT_CLIENT_ID,
    client_secret: process.env.FT_CLIENT_SECRET,
    scope: SCOPE,
  });

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corps,
  });

  if (!r.ok) {
    throw new Error(`Jeton refusé (${r.status}). Vérifier les secrets et la souscription à l'API Offres d'emploi.`);
  }
  return (await r.json()).access_token;
}

async function rechercher(token, params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }

  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (r.status === 204) return []; // aucune offre : réponse vide, pas une erreur
  if (r.status === 429) {
    await pause(2000);
    return rechercher(token, params);
  }
  if (!r.ok && r.status !== 206) {
    console.warn(`  ! ${r.status} sur ${url.searchParams.toString()}`);
    return [];
  }
  const data = await r.json();
  return data.resultats || [];
}

// Le détail d'une offre porte les coordonnées ; la recherche ne les donne pas.
async function detail(token, id) {
  const r = await fetch(API_DETAIL + encodeURIComponent(id), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return r.json();
}

async function main() {
  const profil = JSON.parse(await readFile(new URL("../profil.json", import.meta.url)));
  const token = await jeton();

  const brutes = new Map();

  for (const commune of profil.recherche.communes) {
    for (const rome of profil.recherche.codesROME) {
      const res = await rechercher(token, {
        codeROME: rome,
        commune: commune.code,
        distance: commune.distance,
        typeContrat: profil.recherche.typeContrat,
        range: "0-99",
      });
      console.log(`${commune.nom} / ${rome} : ${res.length} offres`);
      for (const o of res) brutes.set(o.id, o);
      await pause(600); // 2 appels/s max côté France Travail : on reste large
    }
  }

  // État précédent : sert à repérer ce qui est nouveau depuis la dernière passe.
  let precedent = { offres: [] };
  try {
    precedent = JSON.parse(await readFile(new URL("../data/offres.json", import.meta.url)));
  } catch {
    console.log("Pas d'état précédent, première collecte.");
  }
  const dejaVues = new Map(precedent.offres.map((o) => [o.id, o]));

  const offres = [];
  for (const o of brutes.values()) {
    const { score, touches, alertes, age, exigences } = scorer(o, profil);
    if (score <= -900) continue; // métier écarté : inutile de le garder
    const strat = strategie(o);
    const ancienne = dejaVues.get(o.id);

    offres.push({
      id: o.id,
      intitule: o.intitule,
      url: o.origineOffre?.urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
      entreprise: {
        nom: o.entreprise?.nom || "Entreprise non nommée",
        url: o.entreprise?.url || null,
        trancheEffectif: o.entreprise?.trancheEffectif || null,
        siret: o.entreprise?.siret || null,
      },
      // Contacts donnés par l'employeur lui-même dans l'annonce : la seule
      // source de coordonnées à la fois gratuite et certaine.
      contact: {
        nom: o.contact?.nom || null,
        courriel: o.contact?.courriel || null,
        telephone: o.contact?.telephone || null,
        coordonnees: [o.contact?.coordonnees1, o.contact?.coordonnees2, o.contact?.coordonnees3]
          .filter(Boolean).join(" · ") || null,
        urlPostulation: o.contact?.urlPostulation || o.contact?.urlRecruteur || null,
      },
      exigences,
      lieu: o.lieuTravail?.libelle || null,
      commune: o.lieuTravail?.commune || null,
      contrat: o.typeContratLibelle || o.typeContrat,
      romeCode: o.romeCode,
      romeLibelle: o.romeLibelle,
      dateCreation: o.dateCreation,
      description: (o.description || "").slice(0, 1200),
      score,
      touches,
      alertes,
      age,
      canal: strat.canal,
      conseil: strat.note,
      vueLe: ancienne?.vueLe || new Date().toISOString().slice(0, 10),
      nouvelle: !ancienne,
    });
  }

  offres.sort((a, b) => b.score - a.score);

  // Enrichissement : coordonnées des meilleures offres, une requête chacune.
  const aEnrichir = offres.filter((o) => o.score > 0).slice(0, MAX_DETAILS);
  let trouves = 0;
  for (const o of aEnrichir) {
    const d = await detail(token, o.id);
    await pause(150); // 10 appels/s autorisés : on reste sous la limite
    if (!d) continue;
    const c = d.contact || {};
    o.contact = {
      nom: c.nom || null,
      courriel: c.courriel || null,
      telephone: c.telephone || null,
      coordonnees: [c.coordonnees1, c.coordonnees2, c.coordonnees3].filter(Boolean).join(" · ") || null,
      urlPostulation: c.urlPostulation || c.urlRecruteur || d.origineOffre?.urlOrigine || null,
    };
    if (d.entreprise?.url && !o.entreprise.url) o.entreprise.url = d.entreprise.url;
    if (o.contact.courriel || o.contact.telephone) trouves++;
  }
  console.log(`Détails consultés : ${aEnrichir.length} · coordonnées trouvées : ${trouves}`);

  await writeFile(
    new URL("../data/offres.json", import.meta.url),
    JSON.stringify({ misAJour: new Date().toISOString(), total: offres.length, offres }, null, 2)
  );

  // Corps de l'issue GitHub : c'est lui qui déclenche la notification mail.
  const seuil = profil.seuilAlerte ?? 12;
  const alertes = offres.filter((o) => o.nouvelle && o.score >= seuil);

  const md = alertes.length
    ? [
        `**${alertes.length} nouvelle(s) offre(s)** au-dessus du seuil de ${seuil}.`,
        "",
        ...alertes.map(
          (o) =>
            `- **${o.score}** · [${o.intitule}](${o.url}) — ${o.entreprise.nom}, ${o.lieu}\n  ` +
            `canal conseillé : ${o.canal}${o.touches.length ? ` · touches : ${o.touches.slice(0, 6).join(", ")}` : ""}` +
            `${o.alertes.length ? `\n  ⚠︎ ${o.alertes.join(", ")}` : ""}`
        ),
      ].join("\n")
    : "";

  await writeFile(new URL("../data/nouvelles.md", import.meta.url), md);
  console.log(`\n${offres.length} offres retenues, ${alertes.length} au-dessus du seuil.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
