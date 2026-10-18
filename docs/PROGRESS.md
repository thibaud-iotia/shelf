# Avancement

Journal de bord : état de chaque phase, décisions prises, points ouverts.
À mettre à jour à la fin de chaque tâche.

## État

| Phase                               | Statut      | Branche    |
| ----------------------------------- | ----------- | ---------- |
| 0 — Squelette                       | ✅ terminée | `phase-0`  |
| 1 — Bibliothèque manuelle           | ✅ terminée | `phase-1`  |
| 2 — Détection automatique           | ✅ terminée | `phase-2`  |
| 2b — Synchro bibliothèques en ligne | ✅ terminée | `phase-2b` |
| 3 — Métadonnées et visuels          | ✅ terminée | `phase-3`  |
| 4 — UI                              | ✅ terminée | `phase-4`  |
| 5 — Confort                         | ✅ terminée | `phase-5`  |
| 6 — Packaging                       | ✅ terminée | `phase-6`  |

Phases 1 à 6 réalisées d'une traite à la demande de l'utilisateur (« fais toutes les phases d'un
coup, je veux voir le résultat final »), un commit par phase, toutes fusionnées dans `main`.

Bilan des tests : 114 unitaires, 24 e2e (+ 1 test de fumée de l'app packagée).

## Phase 0 — Squelette

- electron-vite 6 + React 19 + TS 6 strict + Tailwind 4, ESLint 10 + Prettier ; IPC typé ; SQLite + Drizzle ; e2e Playwright.
- Fenêtre sans cadre natif : contrôles en overlay couleur `--surface-page`, bande de drag de 36 px (retour utilisateur : « le haut de la fenêtre n'est pas fondu avec l'app »).

## Phase 1 — Bibliothèque manuelle

- `games:*` (liste, détail, création, édition, suppression, choix d'exécutable, dossier).
- `GameRunner` : `spawn` détaché dans le dossier du jeu, suivi de la fin du processus, `play_sessions`
  ouvertes au lancement et fermées à la sortie (les sessions orphelines sont supprimées au démarrage).
- Événement `games:running` → badge « En cours », bouton « ● En cours… », liste « EN COURS » dans la sidebar.
- Plans de lancement : Steam/Epic via URI du launcher (non mesurés), GOG via exe sinon URI, `.app` via `open -W`.

## Phase 2 — Détection

- Parseur VDF ; Steam (`libraryfolders.vdf` ancien et nouveau format, `appmanifest_*.acf`, StateFlags, outils exclus) ;
  Epic (`.item`, DLC et moteurs exclus ; Legendary/Heroic `installed.json`) ; GOG (registre via `reg query`,
  `goggame-*.info`, Heroic) ; itch (`butler.db` en lecture seule) ; scan de dossiers (un jeu par sous-dossier,
  meilleur exécutable, exclusions + exclusions personnalisées).
- Écran « Jeux détectés » (maquette 04) : jeux des launchers = correspondances automatiques, trouvailles de dossiers à vérifier,
  doublons (Fusionner / Ignorer), exclus (Restaurer), « Tout importer ». Assistant (maquette 05).
- Les jeux d'un launcher disparus d'un scan réussi passent « non installés » (sauf exécutable fusionné toujours présent).
- Rafraîchissement silencieux des états d'installation au démarrage.

## Phase 2b — Comptes

- Steam Web API (SteamID64, URL de profil ou nom personnalisé ; profil privé expliqué ; `playtime_forever` affiché à part).
- GOG option A (base locale Galaxy 2.0) ; option B derrière le réglage « Activer la connexion au compte GOG »
  (fenêtre de connexion dédiée, refresh token tourné et chiffré).
- Epic via Legendary (`status --json`, `list --json`), sans réimplémenter l'auth Epic ; itch.io (clés possédées, paginé).
- Synchro manuelle + automatique au démarrage si > 24 h ; erreurs stockées sur le compte (`lastError`).
- Bouton « Installer » → URI du launcher.

## Phase 3 — Métadonnées

- IGDB (jeton Twitch mis en cache), SteamGridDB (grilles 600×900, héros, logos ; par appid Steam si possible).
- Cache `userData/covers` servi par `shelf-media://` (garde contre la traversée de chemin, testé en e2e).
- Clés chiffrées par `safeStorage` dans `secrets.json`, jamais renvoyées au renderer (champs masqués).
- Choix de correspondance IGDB dans l'import, dialogue « Rechercher les métadonnées », « Actualiser les visuels »,
  jaquette personnalisée ; enrichissement en arrière-plan après import et synchro (titre exact seulement si aucun choix).

## Phase 4 — UI

- Barre de filtres (`/`), grille ↔ liste, chips Tous / Installés / Non installés / Favoris / Tag, palette Ctrl/⌘K
  (recherche floue, ↵ jouer, Tab fiche, actions), menu contextuel (maquette 07), tags, collections manuelles
  (glisser-déposer sur la sidebar) et intelligentes (règles), masquer, Apparence, Raccourcis, navigation clavier.

## Phase 5 — Confort

- Tray (jeux récents, Ouvrir, Quitter), fermeture vers la barre système, lancement à l'ouverture de session
  (appliqué seulement par l'app installée), désinstallation Steam par URI, export zip des sauvegardes,
  runner Wine/Proton (Linux).

## Phase 6 — Packaging

- electron-builder : NSIS (Windows), AppImage + deb (Linux), dmg non signé (macOS), icônes générées, `publish: null`.
- Renderer minifié (350 kB au lieu de 900 kB). Workflow GitHub Actions (check, e2e, installeurs) optionnel.
- Installeur Windows vérifié localement : `release/Shelf-0.1.0-win-x64.exe` ; test de fumée de l'app packagée vert.

## Retours après le premier jet

- Temps de jeu : celui du launcher fait foi (retour : « mets que celui de Steam ou Epic »). Total =
  temps du compte (Steam `playtime_forever`, GOG Galaxy `GameTimes`) + sessions mesurées par Shelf.
  Pas de double compte : un lancement par URI (`steam://`, Epic) n'ouvre jamais de session Shelf, et
  Galaxy ne voit pas un exécutable GOG lancé directement par Shelf. Fiche : « Selon Steam ».
  Epic (Legendary) et itch n'exposent pas de temps : seul le temps mesuré par Shelf compte.

## Décisions et écarts au plan

- `GameSource.launch()` n'existe pas : le lancement est décidé par `launch/plan.ts` depuis la ligne en base
  (même logique pour toutes les sources, plus simple à tester). `AccountSource.installUri` vit dans `sources/uris.ts`.
- Désinstallation : seul Steam expose une URI fiable ; les autres launchers se désinstallent depuis leur interface.
- Un seul `migration 0001` regroupe les colonnes ajoutées par les phases 1 à 5 (métadonnées, playtime externe,
  sauvegardes, runner, type de compte, règles de collection).
- Lancement au démarrage non appliqué en dev (il enregistrerait le binaire Electron nu).
- Dépendance ajoutée : `fflate` (zip pur JS, sans dépendance).

## Points ouverts

- macOS et Linux non testés sur machine réelle (code et CI prêts) ; dmg non signé.
- Steam ne permet pas de mesurer la durée des sessions lancées via `steam://` : le temps vient du compte, à jour après synchro.
- Temps Epic non récupéré (Legendary ne l'expose pas).
- Polices : sous-ensemble latin uniquement.
- Thème clair non exposé (le DS le fournit, l'UI utilise les tokens sombres).
- Synchro GOG option B et Legendary non testées contre les vrais services (fixtures uniquement).
