# Boutique : premier affichage fluide

Retour : « la première fois que j'ouvre la Boutique c'est assez long, après ça va ».

## Diagnostic

Le ressenti venait bien du cache, mais pas seulement : **le premier affichage enchaînait les
requêtes réseau une par une**. Le cache du main (10 min, en mémoire) masquait le problème aux
visites suivantes.

Chemin critique au premier clic (avant) :

| Bloc de l'accueil             | Requêtes en série                                                                  | Allers-retours |
| ----------------------------- | ---------------------------------------------------------------------------------- | -------------- |
| Promotions (bannière, cartes) | `stores` → `deals` → `GetItems` (50 appids) → `GetItems` (10 suivants)             | 4              |
| Liste de souhaits (120 jeux)  | `GetWishlist` → `GetItems` ×3 → `stores` → prix CheapShark par paquets de 10 : ×12 | 17             |
| Accueil complet               | les deux, en parallèle mais partageant `stores`                                    | 16             |

Puis les images (en-têtes Steam) partaient seulement une fois les données reçues, via le proxy
`shelf-media://remote/`, sans aucun préchargement : bannière vide encore un moment.

Autres constats :

- cache par **paquet** (`steam-items:<50 appids joints>`) : la liste de souhaits et les promotions
  ne partageaient rien, même pour des jeux communs ;
- deux appels simultanés à `wishlist()` (accueil + compteur d'onglet) pouvaient lancer deux
  imports Steam ;
- côté renderer, `gcTime` par défaut (5 min) : en revenant sur la Boutique après 5 min hors de la
  page, tout repartait de zéro avec « Chargement… ».

## Ce qui a changé

1. **Requêtes en parallèle** (`main/store/service.ts`)
   - `deals()` : `stores` et `deals` partent ensemble ;
   - `decorate()` : les noms de magasins ne bloquent plus le reste (ils ne servent qu'à
     étiqueter les offres) ;
   - liste de souhaits : `stores` part avec `GetWishlist`, et les prix CheapShark sont demandés
     dès que les appids sont connus, pendant que Steam répond pour les noms et les prix en € ;
   - les paquets d'un même appel partent en parallèle.
2. **Plafond de 4 requêtes simultanées par service** (`limiter`, `main/store/cache.ts`) : chaque
   client (CheapShark, Steam) a sa propre file. CheapShark répond 429 aux rafales ; 4 reste
   raisonnable et ramène les 12 appels de prix à 3 allers-retours.
3. **Cache par id** (`TtlCache.many`) au lieu d'un cache par paquet : un appid déjà connu (ou en
   cours de chargement) n'est plus redemandé, quelle que soit la liste qui le demande. Les ids
   absents d'une réponse sont mis en cache comme absents ; les échecs ne sont jamais gardés.
   Les requêtes en cours sont partagées (un clic pendant le préchauffage attend le
   préchauffage au lieu de tout redemander).
4. **Import Steam dédoublonné** : `syncSteamWishlist()` partage l'import en cours.
5. **Préchauffage au démarrage** (`StoreService.prewarm`, appelé par `main/index.ts`) : 4 s après
   l'ouverture (la bibliothèque s'affiche d'abord), le main charge les promotions, la liste de
   souhaits et les **images des premières cartes** de l'accueil (16 promotions + 10 souhaits,
   dans le cache d'images du proxy). Ne lève jamais : un échec n'est pas gardé, la page
   redemande à l'ouverture. Délai réglable par `SHELF_STORE_PREWARM_MS` (`off` pour le
   désactiver ; désactivé par défaut en e2e).
6. **Préchargement au survol** (`prefetchStore`, `renderer/src/lib/queries.ts`) : survoler ou
   focaliser « Boutique » dans la sidebar remplit le cache TanStack avant le clic (un aller-retour
   IPC si le main est déjà chaud). Un échec est oublié si la page n'est pas ouverte, pour qu'elle
   affiche son propre état de chargement.
7. **Stale-while-revalidate côté renderer** : `gcTime` d'une heure pour les promotions et la
   liste de souhaits. Revenir sur la Boutique affiche aussitôt les dernières données, les prix
   frais arrivent en fond (`staleTime` inchangé : 5 min).

## Résultats

Mesurés par `tests/unit/store-perf.test.ts` (réseau simulé, 100 ms par requête, horloge
virtuelle : le temps écoulé compte exactement les allers-retours du chemin critique) :

| Scénario                                   | Avant | Après                    |
| ------------------------------------------ | ----- | ------------------------ |
| Promotions, cache froid                    | 4     | **2**                    |
| Liste de souhaits de 120 jeux, cache froid | 17    | **4**                    |
| Accueil complet (les deux), cache froid    | 16    | **4**                    |
| Accueil après préchauffage                 | —     | **0** (aucune requête)   |
| Clic pendant le préchauffage               | —     | aucune requête en double |

Estimation (allers-retours × latence) pour ~300 ms par requête et une liste de 120 jeux :
accueil froid d'environ 5 s à environ 1,2 s ; avec le préchauffage, il s'affiche sans attendre
le réseau.

CPU à cache chaud (promotions + liste de 1000 jeux décorées) : 8 à 15 ms sur la machine de dev,
budget du test 150 ms.

## Tests de performance

- **Unitaires** — `tests/unit/store-perf.test.ts`
  - nombre d'allers-retours à froid (promotions, liste de souhaits, accueil complet) ;
  - plafond de 4 requêtes simultanées par hôte ;
  - accueil servi sans aucune requête après `prewarm()` (images des premières cartes incluses) ;
  - clic pendant le préchauffage : pas de requête en double ;
  - prix Steam partagés par appid entre promotions et liste de souhaits ;
  - budget CPU à chaud ;
  - briques : `limiter`, `TtlCache.many` (ids inconnus seulement, absents mis en cache, échecs
    oubliés, expiration), lecture de `SHELF_STORE_PREWARM_MS`.
  - Vérifié contre l'ancien `service.ts` : les trois tests « cold » échouent (4, 17 et 16
    allers-retours).
- **e2e** — `e2e/store.spec.ts`
  - « first visit, store warmed up at startup » : chaque requête simulée prend 1,5 s ; après le
    préchauffage, l'accueil (bannière, cartes, image de la bannière) s'affiche en moins de 1,5 s
    après le clic, sans nouvelle requête vers les services de la boutique ;
  - « hovering "Boutique" » : le survol lance le chargement avant le clic.
  - Nouvelles options de fixture : `storePrewarmMs` (défaut `null` = `off`) et `launchFetch`
    (réponses installées dès le lancement, avant tout préchauffage ; enveloppées dans un objet
    car Playwright lit une option tableau comme un tuple `[valeur, options]`), et `delayMs` sur
    une route de `stubFetch` pour simuler la latence.

## Pistes non retenues

- **Cache disque des réponses** (persistant entre deux lancements) : le préchauffage suffit pour
  le premier clic ; des prix de la veille affichés au démarrage demanderaient de signaler leur
  âge.
- **Préchauffage périodique** : trafic inutile pour qui n'ouvre pas la Boutique ; le
  stale-while-revalidate couvre les visites suivantes.
- **Chargement paresseux de la vue** (`React.lazy`) : le bundle est local, le gain serait
  négligeable devant le réseau.
