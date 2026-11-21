# Mise à jour de Shelf depuis l'app

Demande : « détecter les mises à jour de l'app dans l'app, sans devoir désinstaller à chaque
nouvelle version ».

Explication générique, réutilisable dans d'autres projets :
[docs/guide-mise-a-jour-electron.md](../docs/guide-mise-a-jour-electron.md).

## Choix

| Question                  | Choix                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Moteur                    | `electron-updater` (même écosystème qu'electron-builder, vérif sha512, téléchargement différentiel par `.blockmap`)              |
| Source des versions       | GitHub Releases de `thibaud-iotia/shelf` (dépôt public : aucun jeton dans l'app)                                                 |
| Comportement (choix user) | Téléchargement seul en arrière-plan → bannière « Redémarrer » ; ignorée → installée en silence à la fermeture de Shelf           |
| macOS (choix user)        | App non signée : Squirrel.Mac refuse la mise à jour en place → **détection + lien vers le .dmg**                                 |
| Linux                     | AppImage : en place (fichier remplacé). `.deb` : détection + lien (installer un .deb demande root/pkexec)                        |
| Fréquence                 | 15 s après le démarrage puis toutes les 4 h ; réglage « Rechercher automatiquement » (vrai par défaut) ; bouton manuel           |
| Pendant une partie        | « Redémarrer » désactivé (couperait la session mesurée) ; installée à la fin, ou en quittant                                     |
| Version de développement  | `mode: 'disabled'` : rien n'est vérifié, `updater:check` → `UNAVAILABLE`                                                         |
| Exception réseau          | electron-updater a son propre client HTTP (module `net` d'Electron) → hors `net/http.ts`, limité à GitHub, isolé dans `updates/` |

## Pourquoi plus besoin de désinstaller

- Windows : l'installeur NSIS est identifié par l'`appId` (`fr.perso.shelf`, **ne jamais le
  changer**). Une nouvelle version trouve l'ancienne dans le registre, lance son désinstalleur en
  silence (`--updated`, qui ne touche pas aux données) et réinstalle dans le même dossier. Les données
  (`%APPDATA%\Shelf` : base, covers, secrets) ne sont pas dans le dossier d'installation → conservées.
- C'était déjà vrai en lançant le nouvel `.exe` à la main ; maintenant l'app le fait seule :
  `quitAndInstall(true, true)` = installeur silencieux `/S --updated --force-run`, puis relance.
- macOS : remplacer `Shelf.app` dans Applications. Linux AppImage : le fichier est remplacé.

## Fichiers

| Fichier                                               | Rôle                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/main/updates/service.ts`                         | `UpdateService` (états, planification, une vérif à la fois), `updateMode()`, `manualDownloadUrl()` |
| `src/main/updates/electron-updater.ts`                | adaptateur electron-updater (import à la demande, `autoDownload: false`, `autoInstallOnAppQuit`)   |
| `src/main/updates/attempt.ts`                         | `update-attempt.json` : version tentée au redémarrage, relue au démarrage suivant                  |
| `src/main/updates/simulated.ts`                       | faux flux pour l'e2e : `SHELF_UPDATE_SIMULATE=9.9.9` ou `manual:9.9.9`                             |
| `src/main/updates/index.ts`                           | `createUpdateService()` : choisit le mode et l'adaptateur                                          |
| `src/main/ipc/updater.ts`                             | `updater:state`, `updater:check`, `updater:install`, `updater:openDownload`                        |
| `src/shared/models.ts`                                | `AppUpdateMode`, `AppUpdatePhase`, `AppUpdateState`, réglage `autoUpdateCheck`                     |
| `src/shared/ipc.ts`                                   | canaux + événement `updater:changed`                                                               |
| `src/renderer/src/components/layout/UpdateBanner.tsx` | bannière en bas de la sidebar (progression, « Redémarrer », « Télécharger »)                       |
| `src/renderer/src/views/settings/UpdatesCard.tsx`     | Réglages › À propos › Mises à jour (état, bouton, interrupteur, lien « Nouveautés »)               |
| `electron-builder.yml`                                | `publish: github` → `app-update.yml` dans resources/ + `latest*.yml` à côté des installeurs        |
| `package.json`                                        | `dist` : `electron-builder --publish never` (la CI envoie elle-même les fichiers)                  |
| `.github/workflows/ci.yml`                            | envoie aussi `latest.yml`, `latest-mac.yml`, `latest-linux.yml` et les `.blockmap`                 |

États (`phase`) : `idle` → `checking` → `up-to-date` | `available` (manuel) | `downloading` →
`ready` ; `error` à tout moment (message français, première ligne seulement).

## Installation bloquée (antivirus)

Question : « mon antivirus Avast ne va pas bloquer ce processus ? ». Possible : installeur non
signé, rare (nouvelle empreinte à chaque version), lancé en silence par un autre processus →
profil typique pour CyberCapture / bouclier comportemental. Les données ne risquent rien (NSIS
n'a rien touché si l'installeur ne démarre pas), mais Shelf se fermait sans explication.

Détection : juste avant `quitAndInstall`, `UpdateService.install()` écrit
`userData/update-attempt.json` (`{ version, files, at }`, `updates/attempt.ts`,
`paths.updateAttempt()`). Au démarrage suivant, le service le lit puis l'efface :

- version courante ≥ version tentée → `lastInstall: installed` → toast « Shelf a été mis à jour
  en version X » (puis `updater:dismiss` : pas de nouveau toast au rechargement) ;
- sinon → `lastInstall: failed` → bannière rouge dans la sidebar « Shelf X ne s'est pas
  installée — un antivirus a peut-être bloqué l'installeur » + « Télécharger » (ouvre l'`.exe`
  de la release ; `.AppImage` / `.dmg` / `.deb` ailleurs) + « Ignorer ». Même message dans
  Réglages › À propos.

L'installation à la quitte (`autoInstallOnAppQuit`) n'écrit pas de tentative : pas de faux
« bloqué » si l'utilisateur relance avant la fin de l'installeur.

Côté utilisateur, si Avast bloque : exclure `%LOCALAPPDATA%\shelf-updater\` (téléchargement)
et `%LOCALAPPDATA%\Programs\Shelf\` (installation). Vraie solution : signer l'installeur
(SignPath Foundation gratuit pour l'open source, Certum Open Source, Azure Trusted Signing).

## Publier une version (inchangé)

1. Monter `version` dans `package.json` (semver croissant : electron-updater ignore une version
   inférieure ou égale).
2. `git tag v<version> && git push --tags`.
3. La CI crée la release en brouillon, envoie installeurs + `latest*.yml` + `.blockmap`, puis la
   publie quand les trois OS sont là. Les apps installées la voient au plus tard 4 h après.

## Tests

- Unitaires : `tests/unit/updater.test.ts` (modes, URL manuelle, états, erreurs, réglage, minuteries).
- e2e : `e2e/app-update.spec.ts` (dev = désactivé ; auto : téléchargement → bannière → redémarrage ;
  réglage ; installation bloquée : l'app est relancée sur le même userData avec `launchShelf()`
  → bannière, « Télécharger », « Ignorer » ; manuel : lien ouvert). Option de fixture `appEnv`.
- App packagée : `e2e/packaged.spec.ts` vérifie `resources/app-update.yml` et le mode.

## Limites / reste à faire

- **Transition** : les installations ≤ 1.3.0 n'ont pas le module → installer la première version
  qui l'embarque **à la main, par-dessus** (pas de désinstallation). Ensuite c'est automatique.
- Premier téléchargement complet : la release précédente n'a pas de `.blockmap`. Différentiel à
  partir de la suivante.
- Notes de version vides (`--notes ""` en CI) : le lien « Nouveautés » ouvre la page de la release.
  Piste : `gh release create --generate-notes`.
- Builds non signés : SmartScreen peut avertir au premier lancement manuel ; un antivirus peut
  bloquer l'installeur (détecté, voir plus haut). Signature macOS (99 $/an) = mise à jour en place possible
  (ajouter la cible `zip`, `identity`, notarisation, puis `updateMode` → `auto` sur darwin).
- Si `vars.RELEASES_REPO` pointe un jour vers un autre dépôt : mettre à jour `owner`/`repo` dans
  `publish` (electron-builder.yml) et `RELEASES_URL` (`updates/service.ts`).
