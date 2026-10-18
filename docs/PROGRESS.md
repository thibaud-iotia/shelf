# Avancement

Journal de bord : état de chaque phase, décisions prises, points ouverts.
À mettre à jour à la fin de chaque tâche.

## État

| Phase                               | Statut                                | Branche   |
| ----------------------------------- | ------------------------------------- | --------- |
| 0 — Squelette                       | ✅ terminée, en attente de validation | `phase-0` |
| 1 — Bibliothèque manuelle           | ⏳ à faire                            | —         |
| 2 — Détection automatique           | ⏳                                    | —         |
| 2b — Synchro bibliothèques en ligne | ⏳                                    | —         |
| 3 — Métadonnées et visuels          | ⏳                                    | —         |
| 4 — UI                              | ⏳                                    | —         |
| 5 — Confort                         | ⏳                                    | —         |
| 6 — Packaging                       | ⏳                                    | —         |

## Phase 0 — Squelette

Livré :

- electron-vite 6 (Vite 8) + React 19 + TypeScript 6 strict + Tailwind 4, ESLint 10 (flat) + Prettier.
- Fenêtre "Shelf" 1280×800 (min 960×600), sandbox, navigation et `window.open` bloqués, single-instance.
- IPC typé : `src/shared/ipc.ts` (`app:ping`, `app:info`), handlers avec vérification de l'émetteur,
  réponses `{ ok, data | error }`, preload à liste blanche.
- SQLite (better-sqlite3 13, WAL, foreign keys) + Drizzle 0.45 : schéma complet du modèle v1,
  migration `drizzle/0000_init.sql`, DB `userData/shelf.db`, migrations appliquées au démarrage.
- Renderer : tokens et polices du DS Certflix, ports `Button` / `Input`, sidebar de la maquette 01,
  vue Bibliothèque vide, Réglages › À propos (statut IPC, version, chemins, migrations).
- Tests : 10 unitaires (DB : tables, idempotence, défauts, unicité `(source, sourceId)`, cascade ;
  contrat IPC ; sérialisation d'erreurs) + 5 e2e (titre, isolation Node, ping, canal inconnu, DB + migrations).

Décisions :

- Nom **Shelf** au lieu de Cartouche ; `appId fr.perso.shelf`.
- Maquette importée par export manuel (le MCP claude-design renvoyait 403) ; bundle décodé,
  tokens copiés verbatim, référence dans `docs/DESIGN.md`.
- Le schéma complet est posé dès la migration 0 pour éviter des migrations de rattrapage en phase 1.
- `contextBridge` perd les propriétés custom des erreurs → le preload renvoie l'enveloppe brute
  et `renderer/src/lib/ipc.ts#call` lève l'`AppError`.
- e2e : l'app est lancée depuis la racine du repo (`args: ['.']`) pour que `app.getVersion()`
  lise `package.json` ; `SHELF_USER_DATA` isole les données de chaque test.
- Migrations résolues depuis `__dirname` en dev (`out/main/../../drizzle`) et `resourcesPath` une fois packagé.

Points ouverts :

- Bundle renderer non minifié (~720 kB) : à traiter au packaging (phase 6).
- Polices : sous-ensemble latin uniquement (suffisant pour le français).
- Icônes d'application : phase 6.

## Prochaine étape — Phase 1

- Canaux IPC `games:list|create|update|delete`, `games:pickExecutable` (dialog), `games:launch`, événement `game:running`.
- Service de lancement : `spawn` détaché, `cwd` = dossier du jeu, suivi de fin de processus, insertion `play_sessions`.
- UI : grille de jaquettes (placeholder dégradé), formulaire d'ajout/édition, indicateur « en cours ».
- e2e : ajout d'un jeu factice (exécutable de test) → lancement → session enregistrée.
