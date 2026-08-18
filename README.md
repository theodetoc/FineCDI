# Cockpit — prospection CDI

Un dépôt, zéro serveur, zéro euro. GitHub Actions fait office de backend, GitHub Pages sert l'interface.

```
profil.json                  ← le seul fichier à retoucher souvent
scripts/collecte.mjs         ← OAuth France Travail + recherche + scoring
scripts/scoring.mjs          ← moteur de score, testable hors ligne
.github/workflows/collecte.yml
data/offres.json             ← produit par l'Action, lu par l'interface
index.html                   ← les 4 onglets
```

## Mise en route

1. **Compte développeur** sur francetravail.io, souscrire à l'**API Offres d'emploi** (accès libre, pas d'habilitation).
2. Dans le dépôt : `Settings → Secrets and variables → Actions` → ajouter `FT_CLIENT_ID` et `FT_CLIENT_SECRET`.
3. `Settings → Pages` → source `main` / racine.
4. Onglet `Actions` → *Collecte des offres* → **Run workflow** pour la première passe.

Le dépôt peut rester public : les secrets vivent dans les Secrets GitHub, jamais dans le code. Seul `data/offres.json` est commité, et il ne contient que des offres publiques.

## Le scoring

Tout se règle dans `profil.json` : poids positifs, poids négatifs, bonus. Rien d'automagique, donc rien d'inexplicable — chaque offre affiche les mots qui l'ont fait monter ou descendre. Si une offre pertinente passe sous le radar, ajouter le mot manquant ; si du bruit remonte, le mettre en négatif.

Les codes ROME de départ sont à vérifier avec l'API ROMEO (elle traduit un intitulé de poste en code) avant d'être figés.

## La notification

L'Action ouvre une **issue GitHub** listant les nouvelles offres au-dessus de `seuilAlerte`. GitHub envoie l'email tout seul, sans configuration SMTP.

## Ce que l'appli ne fait pas

- **Pas de recherche de personnes sur LinkedIn** : leur API est fermée et le scraping est hors CGU. L'onglet Entreprises génère cinq requêtes X-ray ciblées (RH, direction, partenariats, manager métier, proximité géo) — le repérage se fait à l'œil, en un clic par cible.
- **Pas de vérification d'adresses mail** : c'est payant partout. Les contacts se saisissent à la main.

## Vos données

Contacts, pipeline et modèles sont dans l'IndexedDB du navigateur, jamais commités : ce sont des données nominatives de tiers et une recherche d'emploi en cours. Sauvegarde par `Exporter mes données`.

## À ajouter ensuite

- La Bonne Boîte, dès que l'habilitation manuelle est validée (sans elle : `403 Invalid scope`) — elle alimentera l'onglet Entreprises en boîtes qui recrutent sans avoir publié d'offre.
- L'API Marché du travail pour repérer les secteurs en tension autour d'Aix.
- SIRENE pour l'effectif exact et la date de création, qui affinent le canal conseillé.
