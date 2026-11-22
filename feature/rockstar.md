# Rockstar Games Launcher

Demande : « rajoute toutes les fonctionnalités qu'il y a par exemple sur Steam, mais pour le
launcher Rockstar Games ». Branche `feature/rockstar`.

Choix de l'utilisateur (questions posées avant de commencer) :

- jeux possédés non installés : **connexion Social Club** (fenêtre de connexion Rockstar, API
  web non officielle), plutôt qu'un catalogue à cocher ;
- « Installer » : **ouvrir le launcher sur l'installation du jeu, puis suivre** jusqu'à la fin.

## Ce que le launcher expose (relevé sur une vraie machine, launcher 1.0.110, GTA V)

| Besoin                    | Source                                                                                                                                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jeux installés            | Entrées de désinstallation Windows (`HKLM\SOFTWARE\[WOW6432Node\]Microsoft\Windows\CurrentVersion\Uninstall\*`) dont `UninstallString` = `"…\uninstall.exe" -enableFullMode -uninstall=<titleId>` ; `InstallLocation`, `DisplayName`, `DisplayIcon`, `DisplayVersion`. `launcher` exclu. |
| Launcher                  | `HKLM\SOFTWARE\WOW6432Node\Rockstar Games\Launcher` → `InstallFolder` (`Launcher.exe`).                                                                                                                                                                                                  |
| Lancer sans l'interface   | `Launcher.exe -minmodeApp=<titleId>` : ce que fait `PlayGTAV.exe` (« min mode » : petite fenêtre, puis le jeu).                                                                                                                                                                          |
| Installer / désinstaller  | `Launcher.exe -enableFullMode -install=<titleId>` / `-uninstall=<titleId>` (intégrations GOG Galaxy et Playnite).                                                                                                                                                                        |
| Partie en cours, sessions | `Documents\Rockstar Games\Launcher\launcher.log` (+ `.01` à `.09`) : `[<thread>] [gamelaunch] Launching game...`, ` Path: <exe>`, puis `Game exited with code` sur le même thread ; horodatage local.                                                                                    |
| Mises à jour              | Tableau « Installed titles » écrit au démarrage du launcher : colonne Progress = `Up-to-date` ou `131.84 Mo / 5.37 Go` (mise à jour en file / en cours) ; `[titleupdater] Update of <titre> succeeded / was paused`.                                                                     |
| Jeux possédés             | Aucun fichier lisible (`profiletitles.dat` chiffré, plus de lignes « on branch » dans les logs récents). Social Club : `socialclub.rockstargames.com/ajax/getGoogleTagManagerSetupData` → `gamesOwned` = `GTAV_PC\|RDR2_PC\|Launcher_PC`.                                                |
| Temps de jeu              | Aucune API Rockstar. Shelf le mesure depuis les journaux du launcher (sessions exactes, même lancées hors Shelf, tant que le journal les garde : 10 lancements du launcher).                                                                                                             |
| Pas d'URI                 | Aucun protocole enregistré (`rockstar://` n'existe pas) : tout passe par `Launcher.exe`.                                                                                                                                                                                                 |

## Plan / avancement

- [x] Recherche, questions, ce fichier
- [x] `rockstar` dans `GAME_SOURCES` (+ libellés, couleur de la tuile, palette, sidebar, collections)
- [x] Catalogue `shared/rockstar.ts` : titleId, nom, exe, tag Social Club, appid Steam, dossier de sauvegardes, page rockstargames.com
- [x] Détection `sources/rockstar.ts` (registre ; fixture e2e `rockstar/registry.txt`)
- [x] Journal `sources/rockstar-log.ts` : tableau des titres, mises à jour, sessions, demandes de lancement
- [x] Lancement via `Launcher.exe -minmodeApp` (plan `launcher` sans URI), phases, suivi `RockstarWatcher`
- [x] Sessions du journal importées dans `play_sessions` (sans doublon)
- [x] Installation : launcher ouvert sur le jeu + suivi (journal, registre) jusqu'à la fin
- [x] Désinstallation : `Launcher.exe -enableFullMode -uninstall=<id>` + suivi existant (`UninstallWatcher`)
- [x] Mise à jour : badge + « Mettre à jour » (launcher ouvert)
- [x] Compte « Rockstar Games Social Club » : fenêtre de connexion, cookies chiffrés, synchro
- [x] Fiche enrichie : appid Steam du catalogue, lien rockstargames.com ; dossier de sauvegardes par défaut
- [x] Tests unitaires (`tests/unit/rockstar.test.ts`, 33) + e2e (`e2e/rockstar.spec.ts`)
- [x] Vérifié sur la machine réelle (launcher 1.0.110) : GTA V détecté, 7 sessions retrouvées (~4 h), mise à jour de 5,37 Go en attente vue, dossier `GTA V\Profiles` trouvé
- [x] PROGRESS.md

## Décisions

- **Source `rockstar`** ajoutée à `GAME_SOURCES` : pas de migration (l'enum Drizzle n'est qu'un type
  TypeScript, aucune contrainte SQL). Les réglages `enabledLaunchers` enregistrés avant n'incluent
  pas Rockstar : il faut l'activer dans Réglages › Bibliothèque si la liste avait été modifiée.
- **Pas d'exécutable** stocké pour un jeu Rockstar (`executablePath` null) : il démarre toujours par
  `Launcher.exe` (DRM, Social Club, sauvegardes cloud), même si l'utilisateur en choisit un, comme Steam
  et Epic. Aucun protocole d'URI : le plan `launcher` a désormais une `uri` facultative ; sans URI, un
  échec de démarrage du launcher est une erreur claire au lieu d'un repli.
- **Partie en cours** : le log dit qui démarre et quand il sort (même thread). Une session sans ligne de
  sortie (launcher tué) est vérifiée par la liste des processus (`tasklist`, exe du log + exe du
  catalogue : le log peut nommer le wrapper BattlEye `GTA5_BE.exe`). Phases : `launcher` (min mode
  qui démarre) puis `waiting` dès « Launch requested by user / Creating RGL min mode launch ».
  Délai d'abandon : 20 min (le launcher peut mettre le jeu à jour avant de le lancer).
- **Temps de jeu** : aucune API Rockstar. Les exécutions du log (start → exit) deviennent des sessions
  Shelf, à l'import des jeux, toutes les 15 min (relecture des launchers) et à la fin d'une partie
  suivie. Ignorées : sessions < 30 s (plantage au démarrage), sans sortie, ou recouvrant une session
  déjà en base (import précédent, session mesurée par Shelf) — idempotent. Jeu retrouvé par dossier
  d'installation, sinon par nom d'exécutable (jeu déplacé). Limite : le launcher ne garde que 10 logs
  (10 démarrages du launcher) ; ce qui est plus ancien et jamais vu par Shelf est perdu.
- **Mises à jour** : le tableau « Installed titles » n'est écrit qu'au démarrage du launcher ; une ligne
  `Update of <nom> succeeded` après lui annule l'attente. Correspondance par dossier (le nom change :
  « Grand Theft Auto V » → « … Legacy »). « Mettre à jour » ouvre le launcher (il télécharge seul).
- **Installation** : `-enableFullMode -install=<id>` ouvre le launcher sur l'installation (dossier et
  confirmation dans sa fenêtre) ; mode `followed` (nouveau) : l'UI montre la progression (taille du
  tableau quand le launcher la donne, pause), « ✕ » = « Ne plus suivre ». Fin = ligne
  `Update/Install of <nom> succeeded` du log (le launcher écrit l'entrée de désinstallation et les
  fichiers avant la fin du téléchargement : le registre seul ne suffit pas), puis relecture des
  launchers. Échec si le log dit `failed`, abandon après 12 h.
- **Désinstallation** : par `Launcher.exe -enableFullMode -uninstall=<id>` (comme Playnite) plutôt
  que `uninstall.exe` du dossier, qui demande l'élévation et le service du launcher.
- **Compte Social Club** (non officiel). Premier jet faux (retour : « quand je suis connecté, Shelf
  continue de me dire que je ne le suis pas ; en fermant la fenêtre : connexion annulée ») :
  `socialclub.rockstargames.com` redirige désormais vers `www.rockstargames.com` (sites fusionnés),
  et Shelf n'attendait la connexion que sur une page Social Club, avec le cookie `BearerToken`.
  Relevé (curl, session Electron sans compte) : `getGoogleTagManagerSetupData` répond **401** tant que
  la session Social Club n'est pas ouverte ; `/Blocker/AuthCheck` l'ouvre par une chaîne de
  redirections via `signin.rockstargames.com/connect/check/socialclub` (cookies sur trois hôtes).
  Version actuelle :
  - fenêtre de connexion sur une session Electron en mémoire, User-Agent Chrome sans « Electron/ » ni
    « Shelf/ » ; dès le retour sur rockstargames.com après le formulaire `signin.` (et à la fermeture de
    la fenêtre), Shelf **essaie la vraie lecture** : liste des jeux, et si 401, `/Blocker/AuthCheck` dans
    une fenêtre cachée de la même session (redirections et scripts comme un navigateur), puis nouvel
    essai. Réussi = connecté. Pop-up de connexion rouverte dans la même fenêtre ;
  - les cookies `*.rockstargames.com` (tous leurs attributs) et le User-Agent sont gardés en JSON dans
    `SecretStore`, puis la session est vidée. Chaque synchro les recharge dans une autre session en
    mémoire (`rockstar-sync`), dont `webRequest` n'autorise que les hôtes Rockstar (+ scripts du CDN
    Rockstar, ni images ni polices), fait la lecture (via `net/http.ts`, `fetch` = `session.fetch`
    avec `credentials: 'include'`, même logique 401 → AuthCheck), puis réenregistre les cookies
    renouvelés et vide la session ;
  - fermeture sans succès : « Connexion Rockstar annulée » si le formulaire n'a pas été vu, sinon le
    refus exact de Social Club et le chemin du journal de diagnostic
    `userData/logs/rockstar-social.log` (pages sans query string, noms des cookies sans valeur, issue
    de chaque essai) ;
  - pseudo et id via `scapi …/profile/getbasicprofile` avec le cookie `BearerToken` (celui de
    `.socialclub.rockstargames.com` en priorité) s'il existe.
  - 2ᵉ retour (2026-11-22, journal de l'utilisateur) : AuthCheck **réussit** (cookies `BearerToken` et
    `AutoLoginCheck` sur `.socialclub.`), mais la liste des jeux reste refusée. Cause pas encore
    connue (pas de code HTTP dans le journal ; cookies Akamai `ak_bmsc`/`bm_sv` et F5 `TS01…` → piste
    anti-bot sur une requête hors page). Ajout : chaque requête est journalisée (code HTTP, type,
    redirection, titre de page ou forme du JSON, jamais de nom ni d'id).
  - 3ᵉ retour (même jour) : `getGoogleTagManagerSetupData` répond **403** JSON `{ Status,
EmailVerified, ProfileHidden, WallHidden, NotAllowed }`, en requête comme en chargement de page →
    session bien ouverte, mais **route fermée** par Rockstar (essai par chargement de page retiré).
    Nouvelle lecture : **profil scapi** — `getbasicprofile` (pseudo) puis
    `getprofile?nickname=…&maxFriends=0`, avec le `BearerToken` de `.socialclub.` ; Shelf cherche un
    tableau `gamesOwned` (chaînes `GTAV_PC` ou objets `{ name, platform }`, `PCROS` = PC). Pas de
    jeton → AuthCheck puis nouvel essai. Profil lu mais sans liste → ancienne route en secours, puis
    erreur explicite « Rockstar ne fournit plus la liste des jeux de ce compte » (pas « expirée »).
    **Confirmé par l'utilisateur** (connexion et jeux lus, 2026-11-22). Le journal montre la forme
    du JSON (clés, booléens, tailles, tags des jeux) si Rockstar la change.
- **Fiche enrichie** : l'appid Steam vient du catalogue (pas de recherche), donc actus, vidéos, avis,
  joueurs, configuration… comme un jeu Steam ; lien « Rockstar Games » vers rockstargames.com en tête.
- **Sauvegardes** : dossier `Documents\Rockstar Games\<jeu>` du catalogue proposé à la détection
  s'il existe, sans écraser un dossier choisi par l'utilisateur (`COALESCE`).

## Limites connues

- Windows seulement (le launcher n'existe pas ailleurs ; sous Linux, Wine/Proton non géré).
- `gamesOwned` vient du site Social Club, non documenté : d'après l'intégration GOG Galaxy, il ne
  liste que les jeux **déjà lancés** au moins une fois avec ce compte. Tags inconnus (GTA V Enhanced,
  Red Dead Redemption, trilogie Definitive) ignorés jusqu'à ce qu'on les connaisse. Connexion et
  synchro testées sur fixtures (forme tirée de l'intégration GOG Galaxy), pas contre le vrai site.
- Phases d'installation et lignes `Install of … succeeded` déduites des lignes de mise à jour vues
  sur la vraie machine (aucune installation complète observée).
- Pas de temps de jeu ni de « dernière session » côté compte Rockstar (rien n'est exposé).
