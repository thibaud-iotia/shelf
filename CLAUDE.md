# Shelf — guide de développement

Application desktop (Electron) personnelle qui centralise, lance et suit les jeux de toutes
provenances (Steam, Epic, GOG, itch.io, ajout manuel), installés ou seulement possédés.

- Plan complet et phases : [docs/PLAN.md](docs/PLAN.md)
- Avancement, décisions, reste à faire : [docs/PROGRESS.md](docs/PROGRESS.md) — **à mettre à jour à chaque fin de tâche**
- Référence visuelle (8 maquettes + design system Certflix) : [docs/DESIGN.md](docs/DESIGN.md)

Identité : `productName: Shelf`, `appId: fr.perso.shelf`, données dans `app.getPath('userData')` (`…/Shelf/`).

## Commandes

| But                                             | Commande                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| Dev (HMR renderer, reload main)                 | `npm run dev`                                                         |
| Build (out/)                                    | `npm run build`                                                       |
| Typecheck (node + web + e2e)                    | `npm run typecheck`                                                   |
| Lint / format                                   | `npm run lint` · `npm run format`                                     |
| Tests unitaires (Vitest)                        | `npm test`                                                            |
| Tests e2e (Playwright + Electron, build inclus) | `npm run test:e2e`                                                    |
| Tout sauf e2e                                   | `npm run check`                                                       |
| Nouvelle migration après modif de `schema.ts`   | `npm run db:generate -- --name <nom>`                                 |
| Installeur de l'OS courant (release/)           | `npm run dist` (`npm run dist:dir` : dossier non empaqueté)           |
| Test de fumée de l'app packagée                 | `SHELF_PACKAGED=release/win-unpacked/Shelf.exe npm run test:packaged` |
| Régénérer les icônes (resources/)               | `npm run icons`                                                       |

Node 24, npm. `better-sqlite3` v13 fournit des prebuilds N-API : même binaire pour Node (Vitest) et Electron, pas de rebuild (`npmRebuild: false`).

## Architecture

```
src/
  shared/          types et logique pure, sans dépendance runtime (importés partout)
    ipc.ts         ★ source unique des canaux IPC (IpcChannels) et des événements (IpcEvents)
    models.ts      DTO échangés (Game, Collection, ImportCandidate, Account, AppSettings…)
    errors.ts      AppError { code, message } sérialisable (VALIDATION, AUTH, RATE_LIMITED, NETWORK…)
    domain.ts      GAME_SOURCES, OWNERSHIPS, INSTALL_STATES, libellés
    library.ts     filtres, règles des collections intelligentes, recherche floue (palette)
    format.ts      temps de jeu, dates, tailles (fr-FR)
  main/            process principal — TOUTE la logique système (fichiers, processus, DB, réseau)
    index.ts       bootstrap : userData, protocole média, services (AppContext), fenêtre, tray, synchro auto
    context.ts     AppContext : database, settings, runner, importer, secrets, accounts, metadata
    window.ts      fenêtre sans cadre (overlay des contrôles), fermeture vers la barre système
    system.ts      tray, lancement à l'ouverture de session
    events.ts      broadcast(event) vers le renderer (+ abonnés main : tray)
    platform/      ★ paths.ts (seul endroit des chemins OS, launcherLocations()), registry.ts (reg query)
    db/            schema.ts (Drizzle), client.ts (openDatabase + migrations)
    games/         repository (CRUD, sessions), organize (tags, collections), validation, titles
    launch/        args (parseur d'arguments), plan (URI launcher / processus / Wine-Proton), runner (suivi des processus)
    sources/       détection locale : vdf, steam, epic, gog, itch, folder-scan, uris (launch/install/uninstall)
    import/        candidates (nouveau / màj / doublon / exclu) + ImportService
    accounts/      synchro des jeux possédés : steam, itch, gog-galaxy (option A), gog-oauth (option B), epic-legendary, service
    metadata/      igdb, steamgriddb, service (clés, recherche, enrichissement)
    media/         cache des images (userData/covers) + protocole shelf-media://
    net/http.ts    ★ seule porte réseau : liste blanche d'hôtes, erreurs claires
    secrets/       SecretStore (safeStorage) — fichier secrets.json chiffré, jamais la DB
    saves/         export zip des sauvegardes
    settings/      SettingsStore (table settings, valeurs validées)
    ipc/           handle.ts (émetteur vérifié, enveloppe { ok, data | error }) + un fichier par domaine
  preload/index.ts expose window.shelf.invoke / on (listes blanches), rien d'autre
  renderer/        React + Tailwind v4 + Zustand (état UI) + TanStack Query (données IPC)
    src/lib/       ipc.ts (call), queries.ts (hooks), actions.ts, shortcuts.ts, artwork.ts
    src/stores/    ui (route, filtres, menus), import, running, toasts
    src/components/ ui/ (DS Certflix), game/, library/ (FilterBar, palette, menu contextuel), import/, layout/, settings/
    src/views/     Library, GameDetail, Collection, Import, Onboarding, Settings (+ settings/ sections)
drizzle/           migrations SQL versionnées (générées, commitées)
resources/         icon.png (paquets), tray.png / trayTemplate.png (barre système)
scripts/           make-icons.cjs
tests/unit/        Vitest ; tests/fixtures/ : launchers factices, réponses API enregistrées, sauvegardes, images
e2e/               Playwright Electron — fixtures { app, page, userDataDir } + options launcherRoot, onboarded
design/            export de la maquette Claude Design (référence, non buildé)
```

### Règles

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Le renderer n'a ni `require` ni `process` (testé en e2e). CSP stricte dans `index.html` (`img-src 'self' data: shelf-media:`).
- **Ajouter un canal IPC** : (1) type dans `IpcChannels` + entrée dans `CHANNELS` de `src/shared/ipc.ts`, (2) `handle()` dans le fichier de domaine de `src/main/ipc/`, (3) hook dans `src/renderer/src/lib/queries.ts`. Le preload ne change pas. Même principe pour un événement (`IpcEvents` / `EVENTS`, `broadcast()`, `window.shelf.on`).
- Les handlers valident leurs arguments et lèvent des `AppError(code, message)` ; le message est affiché tel quel dans l'UI → en français, clair.
- Aucun chemin en dur hors `src/main/platform/paths.ts`. `SHELF_USER_DATA` et `SHELF_LAUNCHER_ROOT` isolent les données et les launchers (tests).
- Secrets (clés API, tokens) : uniquement via `SecretStore` (safeStorage) ; la DB ne stocke qu'une référence (`credentialsRef`).
- Réseau : uniquement via `main/net/http.ts` (liste blanche : Steam Web API, Twitch/IGDB, SteamGridDB, itch.io, GOG). Aucun appel réseau dans les tests : `fetch` injecté + réponses enregistrées (`tests/fixtures/api`).
- Un jeu est unique par `(source, sourceId)` : détection locale, import et synchro font un upsert sur la même ligne. Jeux manuels : `sourceId` = UUID.
- Intégrations non officielles (Epic via Legendary, GOG option B) isolées dans leur module : une erreur est stockée sur le compte (`lastError`) ou la source, jamais propagée au reste.
- Imports : `@shared/*` et `@renderer/*` côté renderer ; chemins relatifs dans main/preload/tests (drizzle-kit ne résout pas les alias).
- Fichiers avec antislashs ou séquences `\u` : les écrire avec l'outil d'écriture de fichiers, pas via heredoc shell (les échappements y sont altérés).

### Tests

- Unitaires : `tests/unit/*.test.ts`. DB en `:memory:` via `openDatabase(':memory:', MIGRATIONS)` ; `helpers.ts` fournit `fakeFetch`, `fakeCipher`, `apiFixture`, `tempDir`.
- e2e : `e2e/*.spec.ts`. L'app est lancée depuis la racine (`args: ['.']`) avec un `userData` jetable et une racine de launchers vide (ou `launcherRoot: LAUNCHER_FIXTURES`). `onboarded: true` par défaut. Dialogues natifs simulés par `stubOpenDialog` / `stubSaveDialog`, `shell.openExternal` remplacé via `app.evaluate`. Le « jeu » factice est `node tests/fixtures/fake-game.cjs <ms>`.
- Une phase n'est terminée que si `npm run check`, `npm run format:check` et `npm run test:e2e` sont verts.

### Git

Branche `main` ; une branche par phase (`phase-0` … `phase-6`), un commit par phase, fusion en fast-forward.
