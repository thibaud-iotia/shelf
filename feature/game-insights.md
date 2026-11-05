# Fiche jeu enrichie (« comme sur Steam »)

Demande : sur la fiche d'un jeu, afficher en plus les actualités, les vidéos, les partages de la
communauté et d'autres infos utiles. Branche `feature/game-insights`.

## Choix validés avec l'utilisateur

- Vidéos : **lecteur intégré** (bandes-annonces Steam en `<video>`, vidéos IGDB/YouTube en iframe
  `youtube-nocookie`). CSP élargie uniquement à ces hôtes (`media-src`, `frame-src`).
- Jeux non Steam (Epic, GOG, itch, manuel) : retrouver l'appid Steam par **l'API de recherche de
  la boutique Steam** (`store.steampowered.com/api/storesearch`, sans clé), titre normalisé exact.
  Appid mémorisé sur le jeu (`games.steam_app_id`), modifiable dans « Modifier ».
- Blocs en plus : **avis Steam**, **succès**, **joueurs en ligne + liens**. Pas de « jeux similaires ».

## API utilisées (vérifiées en réel le 2026-11-04)

| Bloc             | Endpoint                                                                    | Clé ?         |
| ---------------- | --------------------------------------------------------------------------- | ------------- |
| Recherche appid  | `store.steampowered.com/api/storesearch/?term=…&l=french&cc=FR`             | non           |
| Détails boutique | `store.steampowered.com/api/appdetails?appids=…&l=french&cc=FR`             | non           |
| Actualités       | `api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=…&count=…`         | non           |
| Avis (résumé)    | `api.steampowered.com/IStoreBrowseService/GetItems/v1/` (`include_reviews`) | non           |
| Joueurs en ligne | `api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/`        | non           |
| Succès (schéma)  | `ISteamUserStats/GetSchemaForGame/v2/`                                      | oui (compte)  |
| Succès (joueur)  | `ISteamUserStats/GetPlayerAchievements/v1/`                                 | oui + SteamID |
| Succès (rareté)  | `ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/`                 | non           |
| Communauté       | `IPublishedFileService/QueryFiles/v1/` (captures, artworks, guides)         | oui (compte)  |
| Vidéos / liens   | IGDB `videos.video_id`, `websites.url` (si IGDB configuré)                  | IGDB          |

Constats :

- `appdetails.movies` ne donne plus de mp4 (DASH/HLS seulement) ; le mp4 historique reste servi à
  `video.akamai.steamstatic.com/store_trailers/<movieId>/movie_max.mp4` (et `movie480.mp4`).
- `store.steampowered.com/appreviews/<id>?json=1` redirige vers l'accueil : remplacé par
  `IStoreBrowseService/GetItems` (résumé seulement, pas de textes d'avis → lien vers la page d'avis).
- Clé Steam = celle du compte Steam déjà connecté (Réglages › Comptes). Sans compte : message clair
  dans le bloc concerné, le reste de la fiche fonctionne.

## Architecture

- `src/main/insights/steam-store.ts` : URL + parseurs purs (actus, vidéos, avis, joueurs, recherche,
  communauté, succès). Tous testés sur des réponses enregistrées (`tests/fixtures/api/steam-*.json`).
- `src/main/insights/links.ts` : classement des liens (site officiel, wiki, Discord, Reddit…).
- `src/main/insights/service.ts` : `InsightsService` — résolution de l'appid, cache mémoire avec
  durée de vie (10 min), un appel par bloc pour qu'une panne n'en casse pas un autre.
- `src/main/media/remote.ts` : proxy d'images `shelf-media://remote/<url encodée>` → les images
  distantes passent par `net/http.ts` (liste blanche), CSP `img-src` inchangée. Cache mémoire LRU.
- IGDB : `IgdbClient.extras(id)` → vidéos YouTube + sites.
- IPC : `insights:overview`, `insights:news`, `insights:community`, `insights:achievements`.
- Renderer : onglets sous l'en-tête de la fiche — Aperçu · Actualités · Vidéos · Communauté ·
  Succès ; carte latérale : avis, joueurs en ligne, liens.
- YouTube refuse l'embed sans `Referer` (erreur 153) : en-tête ajouté par le main sur les seules
  requêtes `youtube-nocookie.com`.

## Étapes

- [x] Vérifier les API réelles, figer les fixtures
- [x] Migration `0003` : `games.steam_app_id`
- [x] Hôtes réseau + proxy d'images distantes
- [x] Parseurs Steam + liens + IGDB extras
- [x] `InsightsService` + IPC
- [x] UI : onglets, carte latérale, champ « AppID Steam » dans le formulaire
- [x] Tests unitaires (parseurs, service, proxy, validation)
- [x] e2e : fiche avec réponses simulées (fetch du main remplacé), aucun appel réseau réel
- [x] `npm run check`, `format:check`, `test:e2e` verts ; PROGRESS.md à jour
- [x] Retour « je vois pas grand chose dans Aperçu » : Aperçu nourri par `appdetails` (`storeInfo()` :
      description, « À propos » en blocs, genres, caractéristiques, studio, sortie, plateformes, prix,
      manettes, configuration requise, langues, captures) ; galerie + visionneuse ; 3 dernières actus

## Hors périmètre / idées

- Textes des avis (aucune API publique stable aujourd'hui).
- Succès Epic/GOG (pas d'API publique) ; jeux similaires IGDB.
- Lecture DASH/HLS (nécessiterait hls.js/dash.js).
