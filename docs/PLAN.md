# Shelf — Plan de projet

> Nom initialement prévu « Cartouche », remplacé par **Shelf** (décision du 2026-10-18).
> Pour le changer : nom du repo, `productName` / `appId` dans `electron-builder.yml` et `package.json`,
> `WINDOW_TITLE` dans `src/main/window.ts`, `app.setName` dans `src/main/index.ts`, et ce fichier.

## Objectif

Application desktop cross-platform (Windows / Linux / macOS), à usage personnel, pour centraliser,
lancer et suivre mes jeux, quelle que soit leur provenance (Steam, Epic, GOG, itch.io,
jeux standalone ajoutés à la main), y compris les jeux possédés mais non installés.

## Identité

- Nom : Shelf
- `appId` : `fr.perso.shelf`
- `productName` : `Shelf`
- Dossier de données : `app.getPath('userData')` → `.../Shelf/`

## Stack

- Electron + electron-vite + TypeScript (strict)
- Renderer : React + Tailwind + Zustand (état) + TanStack Query (données async)
- Base de données locale : SQLite via better-sqlite3 + Drizzle ORM (migrations versionnées)
- Tests : Vitest (logique main), Playwright (e2e Electron, **dès la phase 0**)
- Packaging : electron-builder (NSIS Windows, AppImage/deb Linux, dmg macOS)
- Design : maquettes Claude Design + design system Certflix (voir `docs/DESIGN.md`)

## Principes d'architecture

- Séparation stricte main / preload / renderer. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Toute la logique système (fichiers, processus, DB, réseau) vit dans le main process.
- IPC typé : un seul fichier `shared/ipc.ts` qui définit les canaux et leurs types, exposé via `contextBridge`.
- Les sources de jeux sont des modules internes qui implémentent des interfaces communes :
  ```ts
  // Détection et lancement des jeux installés
  interface GameSource {
    id: 'steam' | 'epic' | 'gog' | 'itch' | 'manual'
    isAvailable(): Promise<boolean>
    scan(): Promise<DetectedGame[]>
    launch(game: Game): Promise<LaunchResult>
  }

  // Synchronisation des jeux possédés (optionnelle selon la source)
  interface AccountSource {
    connect(): Promise<Account>
    disconnect(accountId: string): Promise<void>
    fetchOwned(account: Account): Promise<OwnedGame[]>
    installUri?(game: Game): string
  }
  ```
- Chemins OS centralisés dans `main/platform/paths.ts` (aucun chemin en dur ailleurs).
- Secrets (clés API, tokens) stockés uniquement via `safeStorage`, jamais en clair dans la DB.

## Modèle de données (première version)

- games : id, title, source, sourceId, ownership ('owned' | 'manual'),
  installState ('installed' | 'not_installed' | 'unknown'),
  installPath, executablePath, launchArgs, coverPath, heroPath, description,
  releaseDate, igdbId, favorite, hidden, addedAt, lastSyncedAt
- accounts : id, source, displayName, externalUserId, credentialsRef (référence safeStorage), lastSyncAt
- play_sessions : id, gameId, startedAt, endedAt, durationSec
- tags, game_tags (many-to-many)
- collections, collection_games
- settings (clé/valeur)

Règle : un jeu est identifié de façon unique par (source, sourceId). La détection locale
et la synchro de compte mettent à jour la même ligne au lieu de créer des doublons.

## Phases

Une phase = une PR / un commit propre, tests verts avant de passer à la suivante.

### Phase 0 — Squelette

- Init electron-vite + React + TS + Tailwind, ESLint/Prettier.
- Fenêtre principale titrée "Shelf", preload, IPC typé avec un endpoint `ping` de test.
- better-sqlite3 + Drizzle, première migration, DB stockée dans `userData`.
- `CLAUDE.md` initial (architecture, commandes dev/test/build).
- Playwright e2e Electron opérationnel.

### Phase 1 — Bibliothèque manuelle

- Ajouter un jeu : sélection d'un exécutable via `dialog.showOpenDialog`, titre, arguments.
- Lister / éditer / supprimer les jeux.
- Lancer un jeu (`child_process.spawn`, `cwd` = dossier du jeu, détaché),
  détecter la fin du processus, enregistrer la session de jeu et le temps total.
- Indicateur "en cours d'exécution" dans l'UI.

### Phase 2 — Détection automatique des jeux installés

- Steam : lire `libraryfolders.vdf` puis les `appmanifest_*.acf` (parser VDF), lancement via `steam://rungameid/<id>`.
- Epic : manifests `.item` (JSON) dans `ProgramData/Epic/EpicGamesLauncher/Data/Manifests` (Windows) ;
  sur Linux, gérer Heroic/Legendary.
- GOG : registre Windows (`HKLM\SOFTWARE\WOW6432Node\GOG.com\Games`) ou fichiers `goggame-*.info` ; Heroic sur Linux.
- itch.io : base locale de l'app itch (butler).
- Scan d'un dossier choisi par l'utilisateur pour repérer des exécutables
  (exclusions : uninstall, redist, crash reporter, launchers secondaires…).
- Dédoublonnage et écran de validation "jeux détectés" avant import (maquette 04), onboarding (maquette 05).

### Phase 2b — Synchronisation des bibliothèques en ligne

Objectif : afficher aussi les jeux possédés mais non installés, avec un bouton "Installer"
qui ouvre le launcher concerné.

- Steam (API officielle)
  - Steam Web API `IPlayerService/GetOwnedGames` avec `include_appinfo=1` et `include_played_free_games=1`.
  - Réglages : clé API Steam + SteamID64 (aide à la résolution via `ISteamUser/ResolveVanityURL`).
  - Prévenir l'utilisateur que "Détails des jeux" doit être public sur son profil, sinon la liste revient vide.
  - Récupérer `playtime_forever` et l'afficher séparément du temps mesuré localement.
  - Installation : `steam://install/<appid>`.
- GOG (pas d'API publique officielle)
  - Option A, prioritaire : lire la base locale de GOG Galaxy (`galaxy-2.0.db`, SQLite) si présente.
  - Option B, derrière un flag : connexion OAuth au compte GOG comme le fait Heroic,
    fenêtre de login Electron dédiée, refresh token stocké via `safeStorage`.
- Epic (non officiel)
  - S'appuyer sur Legendary (CLI) s'il est installé : `legendary list --json`.
    Ne pas réimplémenter l'authentification Epic.
- itch.io
  - API avec clé utilisateur : endpoint des clés possédées, paginé.

Exigences communes :

- Synchro manuelle (bouton) + automatique au démarrage si la dernière date de plus de 24 h.
- Fusion avec la détection locale : installé + possédé → une seule entrée.
- Gestion propre des erreurs (clé invalide, profil privé, rate limit) avec message clair dans l'UI.
- Les intégrations non officielles (GOG option B, Epic) sont isolées dans leur module :
  si elles cassent, le reste de l'appli continue de fonctionner.
- Tests avec réponses API enregistrées en fixtures, aucun appel réseau dans les tests.

### Phase 3 — Métadonnées et visuels

- IGDB (auth Twitch client credentials) pour titre, description, date, genres.
- SteamGridDB pour jaquettes, héros, logos.
- Cache local des images dans `userData/covers`, servies via un protocole custom (`protocol.handle`).
- Clés API saisies dans les réglages (maquette 08), stockées via `safeStorage`.

### Phase 4 — UI

- Vue grille (jaquettes) et vue liste, recherche instantanée, palette `Ctrl/⌘K` (maquettes 01, 02).
- Filtres : source, tag, favoris, et "Installés / Non installés / Tous" (jaquettes des non installés en grisé).
- Page détail (maquette 03) : visuels, infos, temps de jeu (local et Steam), dernière session,
  boutons Jouer / Installer / Ouvrir le dossier / Éditer.
- Tags, collections, favoris, masquer un jeu (maquettes 06, 07).
- Page "Comptes" dans les réglages : connecter / déconnecter / resynchroniser chaque source.
- Thème sombre par défaut, navigation au clavier (manette en option plus tard).

### Phase 5 — Confort

- Icône dans la barre système, lancement au démarrage (option).
- Désinstallation via les URI des launchers quand elles existent.
- Sauvegarde des dossiers de saves (chemins configurables par jeu, export zip).
- Linux : option de lancer un `.exe` via Wine/Proton (chemin du runner configurable).

### Phase 6 — Packaging

- Config electron-builder pour les 3 OS (`appId: fr.perso.shelf`, `productName: Shelf`), icônes.
- Auto-update désactivé (usage perso).
- Script de build CI GitHub Actions optionnel.

## Écarts assumés (voir docs/PROGRESS.md)

- Le lancement est décidé par `main/launch/plan.ts` plutôt que par `GameSource.launch()`.
- Désinstallation par URI uniquement pour Steam.
- Phases 1 à 6 livrées d'une traite à la demande de l'utilisateur, un commit par phase.

## Consignes de développement

- Avancer phase par phase et demander validation à la fin de chacune.
- Écrire des tests unitaires pour les parseurs (VDF, manifests Epic, GOG, réponses API) avec des fixtures.
- Tests e2e Playwright pour chaque parcours utilisateur ajouté.
- Aucun accès réseau hors des API listées (Steam Web API, IGDB, SteamGridDB, itch.io, GOG si option B).
- Garder `CLAUDE.md` et `docs/PROGRESS.md` à jour.
