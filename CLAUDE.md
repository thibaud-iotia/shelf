# Shelf — guide de développement

Application desktop (Electron) personnelle qui centralise, lance et suit les jeux de toutes
provenances (Steam, Epic, GOG, itch.io, ajout manuel), installés ou seulement possédés.

- Plan complet et phases : [docs/PLAN.md](docs/PLAN.md)
- Avancement, décisions, reste à faire : [docs/PROGRESS.md](docs/PROGRESS.md) — **à mettre à jour à chaque fin de tâche**
- Référence visuelle (8 maquettes + design system Certflix) : [docs/DESIGN.md](docs/DESIGN.md)

Identité : `productName: Shelf`, `appId: fr.perso.shelf`, données dans `app.getPath('userData')` (`…/Shelf/`).

## Commandes

| But                                             | Commande                              |
| ----------------------------------------------- | ------------------------------------- |
| Dev (HMR renderer, reload main)                 | `npm run dev`                         |
| Build (out/)                                    | `npm run build`                       |
| Typecheck (node + web + e2e)                    | `npm run typecheck`                   |
| Lint / format                                   | `npm run lint` · `npm run format`     |
| Tests unitaires (Vitest)                        | `npm test`                            |
| Tests e2e (Playwright + Electron, build inclus) | `npm run test:e2e`                    |
| Tout sauf e2e                                   | `npm run check`                       |
| Nouvelle migration après modif de `schema.ts`   | `npm run db:generate -- --name <nom>` |
| Paquet installable                              | `npm run dist`                        |

Node 24, npm. `better-sqlite3` v13 fournit des prebuilds N-API : même binaire pour Node (Vitest) et Electron, pas de rebuild.

## Architecture

```
src/
  shared/        types et contrats sans dépendance runtime (importés partout)
    ipc.ts       ★ source unique des canaux IPC : IpcChannels, IPC_CHANNELS, ShelfApi
    errors.ts    AppError { code, message } sérialisable à travers l'IPC
    domain.ts    vocabulaire : GAME_SOURCES, OWNERSHIPS, INSTALL_STATES
  main/          process principal — TOUTE la logique système (fichiers, processus, DB, réseau)
    index.ts     bootstrap : userData override, single-instance, DB, IPC, fenêtre
    window.ts    BrowserWindow (titre "Shelf", sandbox, navigation bloquée)
    platform/paths.ts  ★ seul endroit où sont construits les chemins OS
    db/schema.ts Drizzle (games, accounts, play_sessions, tags, game_tags, collections, collection_games, settings)
    db/client.ts openDatabase(file, migrationsFolder) → applique les migrations
    ipc/handle.ts    handle(channel, fn) typé : vérifie l'émetteur, renvoie { ok, data | error }
    ipc/handlers.ts  enregistrement des handlers
  preload/index.ts   expose window.shelf.invoke (liste blanche des canaux), rien d'autre
  renderer/          React + Tailwind v4 + Zustand (état UI) + TanStack Query (données IPC)
    src/lib/ipc.ts   call(channel, …args) → déballe la réponse, lève AppError
    src/lib/queries.ts  hooks TanStack Query
    src/stores/      stores Zustand
    src/components/ui/  ports des composants du DS Certflix (Button, Input…)
    src/styles/certflix-tokens.css  tokens du DS (copie verbatim, ne pas éditer)
drizzle/         migrations SQL versionnées (générées, commitées)
tests/unit/      Vitest (logique main, parseurs avec fixtures dans tests/fixtures/)
e2e/             Playwright Electron — fixture qui lance l'app avec un userData jetable
design/          export de la maquette Claude Design (référence, non buildé)
```

### Règles

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Le renderer n'a ni `require` ni `process` (testé en e2e).
- **Ajouter un canal IPC** : (1) type dans `IpcChannels` + entrée dans `CHANNELS` de `src/shared/ipc.ts`, (2) `handle()` dans `src/main/ipc/handlers.ts`, (3) hook dans `src/renderer/src/lib/queries.ts`. Le preload ne change pas.
- Les handlers lèvent des `AppError(code, message)` ; le message est affiché tel quel dans l'UI → en français, clair.
- Aucun chemin en dur hors `src/main/platform/paths.ts`.
- Secrets (clés API, tokens) : uniquement via `safeStorage` ; la DB ne stocke qu'une référence (`credentialsRef`).
- Un jeu est unique par `(source, sourceId)` (index unique) : détection locale et synchro de compte font un upsert sur la même ligne. Jeux manuels : `sourceId` = UUID.
- Sources de jeux = modules implémentant `GameSource` / `AccountSource` (voir PLAN). Les intégrations non officielles sont isolées : une erreur ne doit jamais casser le reste.
- Réseau : uniquement Steam Web API, IGDB/Twitch, SteamGridDB, itch.io, GOG (option B). Aucun appel réseau dans les tests (fixtures).
- Imports : `@shared/*` et `@renderer/*` côté renderer ; chemins relatifs dans main/preload/tests (drizzle-kit ne résout pas les alias).

### Tests

- Unitaires : `tests/unit/*.test.ts`. DB en `:memory:` via `openDatabase(':memory:', 'drizzle')`.
- e2e : `e2e/*.spec.ts`, fixtures `{ app, page, userDataDir }`. L'app est lancée depuis la racine (`args: ['.']`) avec `SHELF_USER_DATA` pointant vers un dossier temporaire.
- Une phase n'est terminée que si `npm run check` et `npm run test:e2e` sont verts.

### Git

Branche `main` ; une branche par phase (`phase-0`, `phase-1`…), un commit propre par phase, validation de l'utilisateur avant de passer à la suivante.
