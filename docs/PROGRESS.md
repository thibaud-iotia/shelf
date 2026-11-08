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

Bilan des tests : 238 unitaires, 37 e2e (+ 1 test de fumée de l'app packagée).

## Phase 0 — Squelette

- electron-vite 6 + React 19 + TS 6 strict + Tailwind 4, ESLint 10 + Prettier ; IPC typé ; SQLite + Drizzle ; e2e Playwright.
- Fenêtre sans cadre natif : contrôles en overlay **transparent** (`WINDOW_CONTROLS_COLOR`) + voile radial `.window-controls-scrim` derrière les boutons (Windows/Linux) pour la lisibilité sur les images — plus de rectangle opaque quand le contenu défile dessous, bande de drag de 36 px (retour utilisateur : « le haut de la fenêtre n'est pas fondu avec l'app »).
- Barres de défilement discrètes (`app.css`) : fines, sans piste, curseur visible seulement au survol de la zone ; celle de la vue principale (`.app-scroll`) démarre sous la barre de titre (`margin-top: var(--title-bar)`), plus à côté des boutons fenêtre.

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
  La copie de Legendary fournie par Heroic est lancée avec `LEGENDARY_CONFIG_PATH` = `<config Heroic>/legendaryConfig/legendary`
  (sinon elle lit `~/.config/legendary` et ne voit aucun compte) ; le premier binaire connecté à un compte est retenu.
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
- Renderer minifié (350 kB au lieu de 900 kB). Workflow GitHub Actions (check, e2e, installeurs publiés sur tag).
- Installeur Windows vérifié localement : `release/Shelf-0.1.0-win-x64.exe` ; test de fumée de l'app packagée vert.

## Retours après le premier jet

- Temps de jeu : celui du launcher fait foi (retour : « mets que celui de Steam ou Epic »). Total =
  temps du compte (Steam `playtime_forever`, GOG Galaxy `GameTimes`) + sessions mesurées par Shelf.
  Pas de double compte : un lancement par URI (`steam://`, Epic) n'ouvre jamais de session Shelf, et
  Galaxy ne voit pas un exécutable GOG lancé directement par Shelf. Fiche : « Selon Steam ».
  Epic (Legendary) et itch n'exposent pas de temps : seul le temps mesuré par Shelf compte.

- Synchro Steam après chaque partie : un jeu lancé par `steam://` est suivi via le `RunningAppID` de Steam
  (registre Windows `HKCU\Software\Valve\Steam`, `registry.vdf` sous Linux/macOS), sondé toutes les 5 s
  (`launch/steam-watch.ts`). Le jeu apparaît « En cours » ; à sa fermeture, les comptes Steam sont
  synchronisés 60 s plus tard (délai de mise à jour de l'API). Abandon si le jeu ne démarre pas en 10 min.

- Contenus additionnels (retour : « "Alternative look for Ciri" n'est pas un jeu, mets-le dans le vrai jeu ») :
  table `game_dlcs` (migration 0002) rattachée au jeu de base, section « CONTENUS ADDITIONNELS » de la fiche,
  jamais dans la bibliothèque. GOG Galaxy : `ReleaseProperties.isDlc` (à défaut, la pièce `dlcs` du jeu
  parent) ; parent résolu aussi via une autre édition (`allGameReleases`). Écartés : éditions masquées par
  Galaxy (`isVisibleInLibrary = 0`), noms internes (`dlc_15_a`), copies « [A] » d'un même DLC, DLC d'un jeu
  non possédé. La synchro supprime les lignes importées à tort comme jeux, sauf si installées ou configurées
  (exécutable). Galaxy étant une lecture locale, il est resynchronisé à chaque démarrage (les autres
  comptes : > 24 h). Epic (Legendary) et GOG option B écartaient déjà les DLC, sans parent connu.

- CI (`.github/workflows/ci.yml`, retour : « ça évite de release 1 exe et après ne plus avoir de place
  sur GitHub ») : vérifications + e2e sous Linux à chaque push/PR, sans artefact (sauf traces des e2e en
  échec, 7 jours). Sur un tag `v*` (qui doit égaler la version de `package.json`) : version en brouillon,
  installeurs des trois OS envoyés directement dedans (`gh release upload`, aucun quota de stockage
  Actions), test de fumée de l'app packagée sous Windows avant envoi, publication seulement quand les
  trois sont là. Dépôt cible : variable `RELEASES_REPO` (dépôt dédié, jeton `RELEASES_TOKEN`), sinon ce
  dépôt avec `GITHUB_TOKEN`. Vérifications et e2e sous Linux et Windows : sans trousseau système
  (Linux headless), `safeStorage` est indisponible et l'e2e vérifie le refus des clés API ; Windows
  couvre le stockage chiffré. Chemins Windows lus pareil sur tout OS (`titleFromExecutable`, `isInside`).
  v0.1.0 publiée : https://github.com/thibaud-iotia/shelf/releases/tag/v0.1.0

- Fiche enrichie « comme sur Steam » (branche `feature/game-insights`, détail et choix dans
  [feature/game-insights.md](../feature/game-insights.md)) : onglets Aperçu · Actualités · Vidéos ·
  Communauté · Succès ; carte latérale avec évaluations Steam, joueurs en ligne, Metacritic, liens.
  Appid Steam des jeux non Steam trouvé par la recherche de la boutique (titre exact), mémorisé
  (`games.steam_app_id`, migration 0003) et modifiable dans « Modifier ». Communauté et succès
  utilisent la clé du compte Steam connecté. Images distantes via le proxy `shelf-media://remote/`
  (CSP `img-src` inchangée) ; vidéos lues dans la fiche (mp4 Steam, iframe youtube-nocookie).
  `appreviews` de Steam redirige désormais vers l'accueil : résumé des avis via `IStoreBrowseService`.
  e2e : le `fetch` du main échoue par défaut (aucun test ne sort sur le réseau), `stubFetch()`.
  Aperçu complété par la page boutique Steam quand IGDB manque ou en plus : galerie (bande-annonce
  - captures, plein écran ← / → / Échap), description courte, fiche (studio, sortie, plateformes,
    manettes, prix), caractéristiques Steam, 3 dernières actus, « À propos du jeu » repliable,
    configuration requise, langues. IGDB reste prioritaire pour description, genres, studio.

- « Dernière session » affichait « Jamais » pour un jeu joué via son launcher (ex. Clair Obscur
  lancé depuis Steam : aucune session Shelf). La synchro garde maintenant la date du launcher
  (`games.external_last_played_at`, migration 0004 : Steam `rtime_last_played`, GOG Galaxy
  `GameTimes.lastSessionEnd`) ; la date affichée est la plus récente des deux, sans durée quand elle
  vient du launcher (« Hier »). Profite aussi à « Récents » et au menu de la barre système.
- Fiche d'un jeu : retour plus visible, pastille « ‹ Bibliothèque · Échap | titre du jeu » (fond sombre flouté, lisible sur toute image) épinglée sous la barre de
  titre pendant le défilement, libellé selon la vue d'origine (collection, favoris, source…) ; le
  bouton « précédent » de la souris quitte aussi la fiche.

- Mises à jour des jeux (retour : « mon Fortnite n'est pas à jour ») : `games.update_available`
  (migration 0005), relu à chaque lecture des launchers (démarrage, toutes les 15 min, bouton
  « ⟳ Vérifier les mises à jour » de la bibliothèque, `games:checkUpdates`). Sources, toutes locales :
  Steam `StateFlags` (2 = mise à jour requise, 256/512/1024 = en cours/en pause) ou
  `TargetBuildID ≠ buildid` ; Epic : le launcher déplace le `.item` d'un jeu à mettre à jour dans
  `Manifests/Pending` (incomplet) — avant, Fortnite disparaissait donc du scan et passait « non
  installé » ; il reste installé tant que le manifeste complet existe dans `.egstore` ; Legendary :
  `version` de `installed.json` ≠ `build_version` de `assets.json`. Badge « ⟳ Mise à jour », chip
  « Mises à jour · n », bouton « Mettre à jour » (fiche, menu contextuel) : aucun launcher n'expose
  d'URI « mettre à jour » → Steam ouvre `steam://open/downloads`, Epic lance le jeu par le launcher
  (non silencieux, il applique la mise à jour avant), Heroic son flux de lancement. Même cause côté
  Steam : un jeu en cours de mise à jour (`StateFlags` 1026) n'est plus vu « non installé » s'il a
  un `buildid`. Le rafraîchissement silencieux n'écrase plus la détection en cours de l'écran
  d'import et ne relance plus l'enrichissement des métadonnées.

- Supprimer un jeu (retour : « supprimer un jeu Steam via l'application ») : dialogue
  « Supprimer « titre » » (`RemoveGameDialog`, état `removingGameId` du store UI), ouvert depuis le
  menu contextuel (« Supprimer… ») et la fiche (« Désinstaller ou supprimer… »). Deux actions :
  désinstaller du disque (Steam : `steam://uninstall/<appid>` ; GOG et jeux manuels sous Windows :
  le désinstalleur laissé dans le dossier du jeu, `unins000.exe`/`uninstall.exe`, ouvert par
  `shell.openPath` pour passer l'UAC — `sources/uninstall.ts`) et retirer de la bibliothèque. Un jeu
  issu d'un compte synchronisé (`lastSyncedAt`) reviendrait à la synchro suivante : il est masqué à
  la place (réaffichable par le réglage « Afficher les jeux masqués »).
- Lancer un jeu Steam sans ouvrir la fenêtre de Steam (retour : « que Steam reste en fond, réduit
  dans la barre système ») : sous Windows, plan `launcher` = `steam.exe -silent steam://rungameid/<id>`
  (exécutable lu dans `HKCU\Software\Valve\Steam\SteamExe`, sinon Program Files). Steam fermé démarre
  dans la barre système ; Steam ouvert reçoit juste la commande. Échec du lancement → repli sur l'URI.
  Suivi `RunningAppID` inchangé. Linux/macOS et e2e (racine de launchers factice) : URI comme avant.
- Retour visuel du lancement (retour : « quand on clique sur Jouer, c'est comme si rien ne s'était
  passé le temps que Steam se lance en arrière-plan ») : `launch/progress.ts` (`LaunchTracker`) suit
  chaque lancement du clic jusqu'au jeu démarré et pousse `games:launching` (`LaunchProgress[]` :
  phase, launcher, début, début de phase). Phases : `starting` (Shelf prépare), `launcher` (le
  client Steam démarre : pid de `ActiveProcess` à 0 ou mort), `updating` (`Apps\<appid>\Updating`),
  `waiting` (Steam lance le jeu), `handoff` (Epic, GOG : launcher non suivi, affiché 20 s).
  `SteamWatcher` lit désormais un `SteamStatus` (registre Windows ou `registry.vdf`), sonde toutes
  les 1 s tant qu'un lancement est en attente (5 s ensuite), émet `phase` et `expired` (10 min sans
  progrès, jamais pendant une mise à jour → toast « ne s'est pas lancé : vérifiez la fenêtre de
  Steam », événement `games:launchTimeout`). UI : le bouton « Jouer » devient un statut avec
  spinner, libellé et temps écoulé (+ « ✕ » = `games:cancelLaunch`, ne plus attendre) ; après 30 s
  dans la même phase, « Rien ne se passe ? Vérifiez la fenêtre de Steam. » ; badge et spinner sur
  la jaquette, statut dans la vue liste, entrée dans la section « EN COURS » de la sidebar
  (visible depuis toutes les vues : palette, menu contextuel). Double clic ignoré (renderer) et
  refusé (main). Libellés dans `shared/launch.ts`.

- Boutique (retour : « rajoute la partie achats de jeux (Steam, Epic…), les vrais launchers
  tournent en fond ») — branche `feature/store`, détail et choix dans
  [feature/store.md](../feature/store.md). Entrée « Boutique » de la sidebar (et de la palette) :
  liste de souhaits (Steam importée du compte connecté + liste Shelf, table `wishlist`, migration
  0006), promotions et recherche CheapShark (prix en $, complétés par les prix en € de Steam et
  GOG), fiche d'achat par magasin avec plus bas historique. « Acheter » ouvre la page du jeu dans
  le launcher (`steam://store/<appid>`, `goggalaxy://openGameView/<id>`), sinon le navigateur
  (Epic, autres magasins, launcher absent) ; le paiement reste dans le launcher. `PurchaseWatcher` :
  au retour du focus sur Shelf (et toutes les 2 min, 2 h max), synchro du compte du magasin +
  relecture des launchers ; jeu trouvé → retiré de la liste, toast « Achat détecté ». Nouveaux
  hôtes : `www.cheapshark.com` (User-Agent descriptif exigé), `catalog.gog.com`, images
  `cdn1.epicgames.com`, `images.gog-statics.com`.
  Retours : la Boutique s'ouvre sur un accueil (à la une, liste de souhaits, gratuits,
  promotions, mieux notés) au lieu d'une liste de souhaits vide ; un clic sur un jeu ouvre une
  fiche boutique bâtie comme la fiche d'un jeu possédé (héros, galerie, description, actus,
  vidéos, configuration) avec « Acheter · prix » à la place de « Jouer » et les offres par
  magasin dans la carte latérale. Actus sans image utilisable (articles de presse hébergés
  hors liste blanche, patch notes sans image) : l'en-tête Steam du jeu remplace la case noire
  (`parseNews(data, fallbackImage)`, fiches boutique et bibliothèque).

- Boutique, premier affichage (retour : « la première fois est assez longue, après ça va ») —
  branche `perf/store-first-load`, détail et mesures dans
  [feature/store-perf.md](../feature/store-perf.md). Les requêtes partaient en série (4
  allers-retours pour les promotions, 17 pour une liste de 120 jeux) : requêtes en parallèle,
  4 au plus par service (`limiter`), cache par id partagé entre listes (`TtlCache.many`),
  import Steam dédoublonné ; préchauffage 4 s après le démarrage (promotions, liste, images des
  premières cartes ; `SHELF_STORE_PREWARM_MS`) ; préchargement au survol de « Boutique » ;
  `gcTime` d'une heure (données affichées aussitôt au retour, rafraîchies en fond). Résultat : 2
  et 4 allers-retours à froid, 0 après préchauffage. Tests de perf :
  `tests/unit/store-perf.test.ts` (réseau simulé sur horloge virtuelle) et deux e2e dans
  `e2e/store.spec.ts`.

- Prix Instant Gaming (retour : « afficher le prix auquel on pourrait acheter un jeu sur
  Instant Gaming ; tous les jeux y sont en promo, donc la réduction ne veut rien dire ») —
  `store/instant-gaming.ts`. Pas d'API publique : la page de recherche
  (`/fr/rechercher/?q=<titre>`) embarque la réponse Algolia en JSON (`window.searchResults`),
  lue jusqu'à son accolade fermante — une requête donne toutes les éditions avec prix en €,
  stock, plateforme d'activation et pays autorisés, sans parser le HTML des cartes (rendu par
  Vue côté client). Retenu : éditions PC (`platforms` ∋ 1) de ce titre exact
  (`normalizeTitle` sur `name`/`en_name`/`small_name`), hors DLC, brouillons, abonnements,
  free-to-play, prix 0 (= non vendu), pays hors France ; en stock d'abord, puis la moins chère
  (clé Steam d'abord à prix égal) ; 3 au plus affichées. Remise : celle d'IG compare à un prix
  catalogue, elle est ignorée ; la fiche compare au prix **actuel** de Steam en € (promos
  comprises) : badge « -35% vs Steam » si la clé est moins chère, sinon « Steam est moins cher
  (x €) » ou « Même prix ». Canal à part `store:keyshops` (ne lève jamais : `error` dans la
  réponse) : la fiche et ses offres s'affichent sans attendre la page IG (~300 ko) ; section
  « REVENDEUR DE CLÉS » sous les magasins officiels, le bouton « Acheter » du héros reste sur
  l'offre officielle. « Acheter » ouvre la page produit (`/fr/<id>-acheter-<slug>/`, recomposée
  par le main après validation de l'id et du slug) dans le navigateur ; l'achat est suivi sur
  le launcher de la clé (Steam, GOG, Epic). Requêtes avec le User-Agent descriptif de Shelf
  (aucun blocage constaté le 2026-11-08), cache 10 min, 4 au plus en parallèle ; un 403
  (anti-robots) donne « Instant Gaming refuse la requête pour le moment ». Nouvel hôte :
  `www.instant-gaming.com` ; `requestText()` dans `net/http.ts` ; `stubFetch` accepte `html`.

- Recherche de la Boutique : bouton « Effacer » (✕) dans le champ dès qu'il a une valeur
  (retour : « pas de bouton pour clean l'input »). Prop `onClear` du composant `Input` (DS),
  qui vide puis redonne le focus au champ ; testé dans `e2e/store.spec.ts`.

- Nouvelle icône (retour : « plus stylé qu'un vieux S en couleur ») : une étagère, trois
  boîtiers sombres debout et un boîtier corail penché contre eux, marqué d'une manette, sur
  fond encre avec halo corail. `scripts/make-icons.cjs` dessine en SVG, rastérisé par Electron
  à chaque taille (plus de dépendance à la police) ; la barre système utilise un glyphe
  simplifié (tranches + boîtier penché + planche), blanc sur corail (`tray.png`) ou noir
  (`trayTemplate*.png`, macOS). Le logo de la barre latérale (ex-« S ») est la même icône,
  générée par le script sans la marge (`src/renderer/src/assets/logo.png`, 96 px).

## Décisions et écarts au plan

- `GameSource.launch()` n'existe pas : le lancement est décidé par `launch/plan.ts` depuis la ligne en base
  (même logique pour toutes les sources, plus simple à tester). `AccountSource.installUri` vit dans `sources/uris.ts`.
- Désinstallation : seul Steam expose une URI fiable ; GOG et jeux manuels sous Windows passent par le
  désinstalleur du dossier du jeu ; Epic, itch et Linux (scripts GOG à lancer en terminal) se
  désinstallent depuis leur launcher.
- Un seul `migration 0001` regroupe les colonnes ajoutées par les phases 1 à 5 (métadonnées, playtime externe,
  sauvegardes, runner, type de compte, règles de collection).
- Lancement au démarrage non appliqué en dev (il enregistrerait le binaire Electron nu).
- Dépendance ajoutée : `fflate` (zip pur JS, sans dépendance).

## Points ouverts

- macOS et Linux non testés sur machine réelle (code et CI prêts) ; dmg non signé.
- Steam ne permet pas de mesurer la durée des sessions lancées via `steam://` : le temps vient du compte, à jour après synchro.
- Temps Epic non récupéré (Legendary ne l'expose pas).
- Jeux Epic possédés non installés : visibles uniquement via la synchro Legendary/Heroic. Le launcher Epic
  ne garde plus de cache local de la bibliothèque (`OC_<compte>.dat` ne liste que les jeux installés et les assets Unreal).
- Polices : sous-ensemble latin uniquement.
- Thème clair non exposé (le DS le fournit, l'UI utilise les tokens sombres).
- Mises à jour GOG (Galaxy) et itch non détectées : aucune information locale fiable.
  Epic sans Legendary : seules les mises à jour déjà mises en file par le launcher Epic sont vues.
- Synchro GOG option B et Legendary non testées contre les vrais services (fixtures uniquement).
- Fiche enrichie : communauté (`QueryFiles`) et succès (`GetSchemaForGame`, `GetPlayerAchievements`)
  demandent une clé Steam ; leurs fixtures suivent la documentation, pas une réponse réelle enregistrée.
  Lecture YouTube intégrée non vérifiée dans l'app packagée (en-tête `Referer` ajouté pour l'erreur 153).
- Boutique : prix CheapShark en dollars seulement ; Epic ouvert dans le navigateur (pas de slug
  produit fiable) ; liste de souhaits Steam non vérifiée contre un vrai profil public.
- Instant Gaming : lecture d'une page web, sans contrat — un changement du site (ou une
  protection anti-robots plus stricte) vide seulement la section « Revendeur de clés ». Prix
  seulement sur la fiche d'un jeu (une page par jeu) : pour les cartes de la liste de
  souhaits, il faudrait interroger l'index Algolia du site (clé publique de la page, plusieurs
  titres par requête), non fait. Comparaison au seul prix Steam (pas GOG ni Epic).
