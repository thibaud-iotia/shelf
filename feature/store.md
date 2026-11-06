# Boutique : liste de souhaits, prix, achat via les launchers

Demande : « rajouter la partie achats de jeux (Steam, Epic…), toujours dans le cadre où les vrais
launchers tournent en fond (comme quand on exécute un jeu) ». Branche `feature/store` (partie de
`feature/game-insights`, non fusionnée dans `main`).

## Choix validés avec l'utilisateur (2026-11-06)

- **Boutique complète** : nouvelle vue « Boutique » — liste de souhaits, promotions, recherche,
  fiche d'achat avec les prix de chaque magasin, bouton Acheter, détection de l'achat.
- **Prix multi-magasins : CheapShark** (API gratuite, sans clé). Prix en **dollars** (seule devise
  de CheapShark) ; complétés par les prix **en euros** de la boutique Steam (`IStoreBrowseService`,
  `country_code=FR`) et du catalogue GOG (`catalog.gog.com`, `currencyCode=EUR`).
- **Liste de souhaits : Steam + liste Shelf**. Celle du compte Steam connecté est importée
  (`IWishlistService/GetWishlist`, publique, sans clé) ; la liste Shelf accepte n'importe quel jeu.
  Epic et GOG n'exposent pas leur liste sans authentification non officielle.
- **Acheter : launcher, repli navigateur**. Le paiement se fait forcément dans l'interface du
  launcher (ou du site) : Shelf n'achète rien lui-même.

## API (vérifiées en réel le 2026-11-06, fixtures dans `tests/fixtures/api`)

| Usage                    | Endpoint                                                                       | Fixture                       |
| ------------------------ | ------------------------------------------------------------------------------ | ----------------------------- |
| Magasins (noms)          | `www.cheapshark.com/api/1.0/stores`                                            | `cheapshark-stores.json`      |
| Recherche                | `…/games?title=…&limit=…`                                                      | `cheapshark-search.json`      |
| Fiche (offres, plus bas) | `…/games?id=…`                                                                 | `cheapshark-game.json`        |
| Prix d'appids Steam      | `…/deals?steamAppID=a,b,c` (lot)                                               | `cheapshark-deals-steam.json` |
| Promotions               | `…/deals?storeID=1,7,25&onSale=1&sortBy=Deal Rating`                           | `cheapshark-deals.json`       |
| Prix Steam en euros      | `api.steampowered.com/IStoreBrowseService/GetItems/v1/` (`include_basic_info`) | `steam-store-items.json`      |
| Liste de souhaits Steam  | `api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=…`              | `steam-wishlist.json` (doc.)  |
| Produit GOG (id, €)      | `catalog.gog.com/v1/catalog?query=like:…&countryCode=FR&currencyCode=EUR`      | `gog-catalog.json`            |

Constats :

- CheapShark refuse un `User-Agent` générique (`"Missing or generic User-Agent header detected"`) :
  Shelf envoie `Shelf/<version> (+https://github.com/thibaud-iotia/shelf)`.
- Le lien d'achat CheapShark (`/redirect?dealID=…`) répond 403 à un client non navigateur : il est
  seulement ouvert dans le navigateur, jamais suivi par Shelf (pas de contournement).
- La liste de souhaits Steam d'un profil privé (ou vide) répond `{"response":{}}` : impossible de
  distinguer, message « vide ou privée ». Fixture écrite d'après la documentation (aucun profil
  public avec liste n'était disponible pour l'enregistrer).
- Miniatures : CDN Steam (déjà autorisés), `cdn1.epicgames.com`, `images.gog-statics.com` ajoutés
  aux `IMAGE_HOSTS` du proxy.

## Achat : où s'ouvre le bouton « Acheter »

| Magasin | Launcher détecté                                                            | Sinon                                     |
| ------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| Steam   | `steam://store/<appid>` (Steam démarre / reçoit la commande)                | `https://store.steampowered.com/app/<id>` |
| GOG     | `goggalaxy://openGameView/<productId>` (Windows, macOS)                     | `https://www.gog.com/game/<slug>`         |
| Epic    | navigateur (lien CheapShark) : pas de slug fiable sans l'API GraphQL d'Epic | idem                                      |
| Autres  | navigateur (lien CheapShark)                                                |                                           |

## Détection de l'achat

`PurchaseWatcher` garde les achats en attente (2 h max). Au retour du focus sur Shelf (et toutes les
2 min tant qu'il en reste) : synchro des comptes du magasin concerné + relecture des launchers, puis
recherche du jeu dans la bibliothèque (appid Steam, sinon titre normalisé). Trouvé → retiré de la
liste Shelf, événement `store:purchased` → toast « Achat détecté ».

## Architecture

- `src/main/store/cheapshark.ts` : client + parseurs purs (magasins, recherche, offres, promos).
- `src/main/store/steam.ts` : liste de souhaits + prix en euros (`GetItems`).
- `src/main/store/gog.ts` : produit GOG (id, slug, prix en euros) par titre exact.
- `src/main/store/purchase.ts` : cible d'achat (URI launcher ou URL), pure.
- `src/main/store/wishlist.ts` : table `wishlist` (migration 0006), import Steam, liste Shelf.
- `src/main/store/watcher.ts` : `PurchaseWatcher`.
- `src/main/store/service.ts` : `StoreService` (assemble, possession, cache 10 min).
- IPC : `store:wishlist`, `store:syncWishlist`, `store:deals`, `store:search`, `store:game`,
  `store:addWish`, `store:removeWish`, `store:buy` ; événement `store:purchased`.
- Renderer : routes `store` et `storeGame`, entrée « Boutique » de la sidebar, `StoreView`
  (accueil, souhaits, promotions, recherche), `StoreGameView` (fiche boutique).

## Étapes

- [x] Vérifier les API réelles, figer les fixtures
- [x] Migration `0006` : table `wishlist`
- [x] Hôtes réseau, User-Agent
- [x] Parseurs CheapShark / Steam / GOG + cible d'achat (tests unitaires)
- [x] `StoreService`, `PurchaseWatcher` (tests unitaires)
- [x] IPC + événement
- [x] Vue Boutique, fiche d'achat, sidebar, toast
- [x] e2e
- [x] `npm run check`, `format:check`, `test:e2e` verts ; PROGRESS.md

## Retours après le premier jet (2026-11-06)

- « Quand on clique sur Boutique, la page Souhaits est vide, pas fou niveau UX » → la Boutique
  s'ouvre sur un **Accueil** : bannière « À la une » (5 meilleures promotions avec un appid Steam,
  rotation toutes les 8 s, pause au survol), « Votre liste de souhaits » (rangée, nombre de jeux en
  promotion, ou invitation à ♡ / importer la liste Steam), « Gratuits en ce moment », « Promotions
  du moment », « Très bien notés sur Steam ». Onglets Accueil · Liste de souhaits · Promotions,
  recherche dans l'en-tête ; onglet et recherche conservés au retour d'une fiche (store UI).
- « Aucune information sur le jeu sélectionné, il faudrait une belle page comme si c'était mon
  jeu, avec Acheter à la place de Jouer » → la fenêtre d'offres est remplacée par une **fiche
  boutique** (route `storeGame`) construite comme la fiche d'un jeu de la bibliothèque : héros
  (`library_hero` de Steam, sinon capture), pastille retour (Échap / bouton « précédent »),
  onglets Aperçu · Actualités · Vidéos, galerie + bande-annonce, genres, description, fiche Steam,
  dernières actus, « À propos », configuration, langues. Bouton **Acheter · prix** (meilleure
  offre) + ♡ ; une fois possédé : « Dans votre bibliothèque → ». Carte latérale « OÙ L'ACHETER » :
  une offre par magasin (prix €, $, réduction, Acheter, où ça s'ouvre), plus bas historique,
  puis évaluations Steam, joueurs en ligne, liens.
- Main : `InsightsService.overviewForApp(appId)` / `newsForApp(appId)` (mêmes blocs sans jeu en
  base), IPC `store:overview`, `store:news` ; `StoreGameDetail.heroUrl`. Renderer : `BackBar` /
  `TabBar` extraits dans `components/game/DetailChrome.tsx`, `NewsPanel` / `LatestNews` prennent
  une requête (enveloppes `GameNewsPanel` / `GameLatestNews` pour la fiche bibliothèque).
  Communauté et succès restent propres aux jeux possédés.
- « Les actus n'affichent pas les images, carré noir » → vérifié sur de vraies actus (Hades,
  Cyberpunk 2077, CS2) : la plupart des articles de presse ont leurs images sur leur propre site
  (pcgamesn.com, gnwcdn.com, playground.ru…), que le proxy d'images refuse (liste blanche), et
  les patch notes n'en ont pas. Ces actus affichent désormais l'en-tête Steam du jeu
  (`steamHeaderUrl`, déplacé dans `insights/steam-store.ts`).

## Tests

- Unitaires `tests/unit/store.test.ts` (31) : parseurs, cible d'achat, validation, liste de
  souhaits (miroir Steam, liste Shelf, achat), possession, `StoreService` (cache, erreurs de prix,
  sans compte Steam, fiche d'achat, Steam absent de CheapShark), `PurchaseWatcher`.
- e2e `e2e/store.spec.ts` : accueil (à la une, gratuits, promotions), ♡ vers la liste, onglets,
  recherche, fiche boutique (description, onglets, offres triées, € Steam, plus bas historique),
  Acheter · prix sans launcher (navigateur) puis achat détecté au retour du focus, bouton « Dans
  votre bibliothèque », retour Échap jusqu'aux résultats ; avec Steam installé
  (`LAUNCHER_FIXTURES`) → `steam://store/<appid>`.

## Limites connues

- Prix CheapShark en dollars ; seuls Steam et GOG donnent un prix en euros.
- Epic : pas d'ouverture dans le launcher (slug du produit inconnu sans l'API GraphQL d'Epic,
  protégée) → page du magasin dans le navigateur. Le jeu acheté arrive ensuite par la synchro
  Legendary/Heroic ou la détection locale une fois installé.
- Liste de souhaits Steam : profil public requis ; non vérifiée contre un vrai profil.
- Un achat n'est détecté que si le jeu apparaît dans la bibliothèque (compte synchronisé ou jeu
  installé) dans les 2 h ; au-delà il n'est plus suivi (il arrive quand même à la synchro suivante).
