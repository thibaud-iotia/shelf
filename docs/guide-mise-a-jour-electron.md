# Mettre à jour une app desktop sans la désinstaller

Guide générique (Electron + electron-builder + electron-updater), indépendant de Shelf.
But : l'app détecte seule qu'une nouvelle version existe, la télécharge, et s'installe **par-dessus**
l'ancienne en gardant les données de l'utilisateur.

---

## 1. Le principe : pourquoi on n'a pas besoin de désinstaller

Une mise à jour « en place » repose sur trois règles. Si l'une manque, l'utilisateur doit
désinstaller (ou se retrouve avec deux apps, ou perd ses données).

### Règle 1 — Une identité stable

L'installeur reconnaît « la même app » grâce à un identifiant fixe :

| Système | Identifiant                                                                       |
| ------- | --------------------------------------------------------------------------------- |
| Windows | `appId` → GUID de la clé de désinstallation dans le registre (`HKCU\…\Uninstall`) |
| macOS   | `appId` → `CFBundleIdentifier` + même nom `.app` dans `/Applications`             |
| Linux   | nom du paquet (`.deb`/`.rpm`), ou chemin du fichier (AppImage)                    |

**Ne jamais changer `appId` (ni `productName`) après la première publication.** Changer l'un
d'eux = nouvelle app pour l'OS (doublon dans le menu Démarrer, ancienne jamais retirée), et
`productName` change aussi le dossier des données (`app.getPath('userData')`).

### Règle 2 — Code et données séparés

```
Windows   C:\Users\<moi>\AppData\Local\Programs\MonApp\   ← code (remplacé à chaque version)
          C:\Users\<moi>\AppData\Roaming\MonApp\          ← données (jamais touchées)
macOS     /Applications/MonApp.app                       ← code
          ~/Library/Application Support/MonApp/          ← données
Linux     /opt/MonApp ou le fichier .AppImage             ← code
          ~/.config/MonApp/                               ← données
```

Tout ce que l'utilisateur produit (base SQLite, réglages, cache, secrets) va dans
`app.getPath('userData')`, **jamais** à côté de l'exécutable. Ainsi remplacer le code ne touche
pas aux données. Côté NSIS, laisser `deleteAppDataOnUninstall: false` (défaut).

### Règle 3 — Un installeur qui sait « mettre à niveau »

- **NSIS (Windows, electron-builder)** : au lancement, l'installeur lit la clé de registre de
  l'`appId`. S'il trouve une version installée, il ferme l'app, exécute l'ancien désinstalleur en
  mode silencieux avec `--updated` (qui garde les données et les raccourcis), puis installe dans
  **le même dossier**. Lancer le nouvel `.exe` à la main fonctionne donc déjà ; l'auto-update ne
  fait qu'automatiser ce lancement (`/S --updated --force-run`).
- **macOS** : une `.app` est un dossier ; la mise à jour remplace ce dossier (Squirrel.Mac le fait
  automatiquement, mais **seulement si l'app est signée**).
- **AppImage** : un seul fichier, remplacé par le nouveau.
- **deb/rpm** : `dpkg -i nouveau.deb` met à niveau le paquet du même nom (droits root nécessaires).

Et bien sûr : un **numéro de version semver strictement croissant** (`1.3.0` → `1.4.0`).
L'updater ignore une version inférieure ou égale.

---

## 2. Le mécanisme d'auto-update (electron-updater)

```
          CI (sur un tag v1.4.0)                          App installée (v1.3.0)
 ┌──────────────────────────────────┐          ┌───────────────────────────────────────┐
 │ electron-builder                 │          │ resources/app-update.yml              │
 │  ├ MonApp-1.4.0-win-x64.exe      │          │   provider: github, owner, repo       │
 │  ├ MonApp-1.4.0-win-x64.exe.blockmap        │                                       │
 │  └ latest.yml  ◄─ version, sha512, taille   │ 1. lit latest.yml de la dernière      │
 │                                  │  upload  │    release publiée                    │
 │ → GitHub Release v1.4.0  ────────┼─────────►│ 2. 1.4.0 > 1.3.0 → télécharge l'.exe  │
 └──────────────────────────────────┘          │    (différentiel grâce aux .blockmap) │
                                               │ 3. vérifie le sha512                  │
                                               │ 4. quitAndInstall() : lance           │
                                               │    l'installeur /S --updated, quitte  │
                                               │ 5. NSIS met à niveau, relance l'app   │
                                               └───────────────────────────────────────┘
```

Fichiers clés :

| Fichier            | Produit par      | Rôle                                                             |
| ------------------ | ---------------- | ---------------------------------------------------------------- |
| `app-update.yml`   | electron-builder | embarqué dans `resources/` : où chercher les mises à jour        |
| `latest.yml`       | electron-builder | « flux » Windows : version, nom du fichier, sha512, taille, date |
| `latest-mac.yml`   | electron-builder | idem macOS                                                       |
| `latest-linux.yml` | electron-builder | idem Linux (AppImage et deb listés)                              |
| `*.blockmap`       | electron-builder | empreinte par blocs : ne télécharger que ce qui a changé         |

`app-update.yml` et les `latest*.yml` ne sont générés **que si `publish` est configuré**
(avec `publish: null`, rien : pas d'auto-update possible).

### Ce qui marche où

| Cible                        | Mise à jour en place ?                                                     |
| ---------------------------- | -------------------------------------------------------------------------- |
| Windows NSIS                 | ✅ oui (cas idéal ; `perMachine: true` → demande UAC à chaque mise à jour) |
| Windows NSIS « portable »    | ❌ non (pas d'installation) → détection + lien                             |
| Windows MSI / AppX (Store)   | ❌ non avec electron-updater (le Store gère l'AppX)                        |
| macOS signé + notarisé (zip) | ✅ oui (la cible `zip` est **obligatoire** pour Squirrel.Mac)              |
| macOS non signé              | ❌ non (Squirrel refuse) → détection + lien vers le .dmg                   |
| Linux AppImage               | ✅ oui (variable `APPIMAGE` présente)                                      |
| Linux deb / rpm / pacman     | ⚠️ possible (pkexec demande le mot de passe) ; souvent détection + lien    |
| Snap / Flatpak               | géré par le store, pas par l'app                                           |

Stratégie robuste : **un seul mécanisme de détection** (electron-updater lit le `latest*.yml`
de chaque OS) et deux modes d'action :

- `auto` : télécharger puis proposer « Redémarrer » ;
- `manual` : afficher « Version X disponible » + bouton qui ouvre le bon installeur dans le
  navigateur (l'utilisateur l'installe par-dessus, toujours sans désinstaller).

---

## 3. Recette pour un nouveau projet

### 3.1 Dépendance

```bash
npm install electron-updater        # dependencies, pas devDependencies : il tourne dans l'app
```

### 3.2 `electron-builder.yml`

```yaml
appId: fr.moi.monapp # figé pour toujours
productName: MonApp # figé aussi (nom du dossier userData)
artifactName: ${productName}-${version}-${os}-${arch}.${ext} # sans espaces (GitHub les renomme)
win:
  target: [{ target: nsis, arch: [x64] }]
nsis:
  oneClick: false # assistant ; les mises à jour restent silencieuses
  perMachine: false # installation utilisateur : pas d'UAC à chaque mise à jour
mac:
  target: [dmg, zip] # zip requis pour la mise à jour en place (si signé)
linux:
  target: [AppImage, deb]
publish:
  provider: github
  owner: moi
  repo: monapp
  releaseType: release
```

Autres fournisseurs : `generic` (n'importe quel serveur HTTPS / S3 / nginx qui sert les fichiers),
`s3`, `spaces`, `gitlab`, `keygen`.

### 3.3 Publier

Deux options :

- **electron-builder publie lui-même** : `electron-builder --publish always` avec `GH_TOKEN`.
- **La CI envoie les fichiers** (contrôle total, release en brouillon tant que tous les OS ne sont
  pas prêts) : `electron-builder --publish never`, puis
  `gh release upload <tag> release/*.exe release/*.blockmap release/latest*.yml`.

⚠️ En CI sur un tag, electron-builder tente de publier implicitement : passer `--publish never`
si c'est la CI qui envoie. Et **n'oubliez pas les `latest*.yml`** : sans eux les apps ne voient
rien. Publier la release (sortir du brouillon) seulement quand tous les fichiers sont là : le flux
lit la dernière release **publiée**.

### 3.4 Process principal (minimal)

```ts
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

export function setupUpdates(notify: (state: unknown) => void) {
  if (!app.isPackaged) return // pas d'app-update.yml en dev
  autoUpdater.autoDownload = false // on décide quand télécharger
  autoUpdater.autoInstallOnAppQuit = true // téléchargée mais ignorée → installée en quittant
  // Obligatoire : sans écouteur 'error', l'EventEmitter lève l'erreur dans le process.
  autoUpdater.on('error', (e) => notify({ phase: 'error', message: e.message }))
  autoUpdater.on('download-progress', (p) => notify({ phase: 'downloading', percent: p.percent }))

  const check = async () => {
    const result = await autoUpdater.checkForUpdates()
    if (!result?.isUpdateAvailable) return notify({ phase: 'up-to-date' })
    notify({ phase: 'downloading', version: result.updateInfo.version })
    await autoUpdater.downloadUpdate() // sha512 vérifié
    notify({ phase: 'ready', version: result.updateInfo.version })
  }
  setTimeout(() => void check().catch(() => {}), 15_000) // après le démarrage
  setInterval(() => void check().catch(() => {}), 4 * 3600_000) // apps qui restent ouvertes
}

// Sur le clic « Redémarrer » (IPC) :
//   autoUpdater.quitAndInstall(true /* silencieux */, true /* relancer après */)
```

Côté UI : une bannière discrète (« Téléchargement… 42 % » puis « Version X prête — Redémarrer »),
un bouton « Rechercher des mises à jour » dans les réglages, un interrupteur pour désactiver la
vérification automatique.

### 3.5 Tester

- **Logique** : mettre electron-updater derrière une petite interface
  (`check() / download(onProgress) / install()`), et tester le service avec un faux.
- **UI en e2e** : une variable d'environnement qui remplace l'adaptateur par une simulation.
- **Pour de vrai** : installer la version N, publier N+1 (une release de test, ou un serveur
  `generic` local), lancer N. En dev : `dev-app-update.yml` + `autoUpdater.forceDevUpdateConfig = true`.
- Vérifier dans l'app packagée que `resources/app-update.yml` existe.

---

## 4. Pièges fréquents

| Piège                                                      | Conséquence / parade                                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Changer `appId` ou `productName`                           | doublon d'app, données « perdues » (autre dossier userData)                                               |
| Données écrites à côté de l'exe                            | effacées à chaque mise à jour → toujours `app.getPath('userData')`                                        |
| `latest*.yml` non envoyés                                  | aucune app ne voit la nouvelle version                                                                    |
| Release laissée en brouillon / marquée « pre-release »     | invisible pour le flux (sauf `allowPrerelease`)                                                           |
| Tag ≠ version de `package.json`                            | le flux annonce une version, le tag pointe ailleurs → vérifier en CI                                      |
| Dépôt GitHub privé                                         | il faudrait un jeton **dans l'app** (à proscrire) → dépôt public dédié aux releases, ou serveur `generic` |
| Pas d'écouteur `'error'`                                   | exception non interceptée dans le main                                                                    |
| Fermeture « vers la barre système » qui intercepte `close` | `quitAndInstall` ne peut pas quitter → laisser passer quand `before-quit` a été émis                      |
| `requestSingleInstanceLock` oublié                         | l'installeur relance l'app pendant que l'ancienne tourne encore                                           |
| Migrations de données non rétro-compatibles                | une mise à jour casse la base → migrations versionnées appliquées au démarrage                            |
| Première version sans updater                              | les utilisateurs doivent installer **une fois** la version avec updater, à la main (par-dessus)           |
| macOS non signé                                            | pas de mise à jour en place → mode « détection + lien »                                                   |
| App non signée sous Windows                                | SmartScreen au premier lancement manuel ; antivirus possible sur l'installeur (voir ci-dessous)           |
| Redémarrer pendant une tâche longue (jeu, export, upload)  | désactiver « Redémarrer » pendant la tâche ; `autoInstallOnAppQuit` prend le relais                       |

### Antivirus (Avast, AVG, Norton…)

Un installeur **non signé**, **rare** (chaque version a une nouvelle empreinte, donc zéro
réputation) et **lancé en silence par un autre processus** est exactement ce que surveillent
CyberCapture (Avast/AVG) ou les boucliers comportementaux. Ce qui peut arriver :

- le fichier téléchargé est mis en quarantaine → l'updater signale une erreur, l'app continue ;
- l'installeur est bloqué au lancement → l'app s'est déjà fermée et ne revient pas. L'ancienne
  version reste intacte (NSIS n'a rien touché), les données aussi.

Parades :

1. **Détecter l'échec** : écrire `{ version }` dans userData juste avant `quitAndInstall()`. Au
   démarrage suivant : version courante ≥ version notée → « mis à jour » ; sinon → « la mise à
   jour n'a pas pu s'installer (antivirus ?) » + bouton qui ouvre l'installeur à télécharger.
   Effacer la note après lecture. Ne rien noter pour l'installation à la fermeture
   (`autoInstallOnAppQuit`).
2. **Exclusions** côté utilisateur : dossier de téléchargement de l'updater
   (`%LOCALAPPDATA%\<nom>-updater\`) et dossier d'installation.
3. **Signer l'installeur** (la vraie solution : la réputation s'attache au certificat, plus à
   chaque fichier ; SmartScreen se calme aussi). Pistes : SignPath Foundation (gratuit, open
   source), Certum Open Source Code Signing, Azure Trusted Signing (selon le pays). electron-builder
   signe via `CSC_LINK` / `CSC_KEY_PASSWORD` ou `win.azureSignOptions`.
4. Signaler les faux positifs à l'éditeur de l'antivirus (à refaire par version tant que non signé).

---

## 5. Alternatives

- **Electron Forge + Squirrel.Windows** : autre installeur (`%LocalAppData%\MonApp\app-1.4.0\`) ;
  service gratuit `update.electronjs.org` pour les dépôts GitHub publics (`update-electron-app`).
- **Tauri** : plugin `updater` intégré (signature des paquets obligatoire, même logique de flux JSON).
- **.NET / natif Windows** : Velopack (successeur de Squirrel), MSIX avec App Installer.
- **App web / PWA** : pas d'installation, le service worker remplace les fichiers ; même idée de
  « nouvelle version prête → recharger ».

Le schéma reste le même partout : **identité stable + données séparées + flux de version signé
ou haché + installeur qui sait mettre à niveau**.
