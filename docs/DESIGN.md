# Référence visuelle

Source : projet Claude Design « Maquettes Bibliothèque », exporté dans
`design/Maquettes Bibliothèque.html` (bundle autonome : ouvrir dans un navigateur).
Design system : **Certflix** (`_ds/certflix-design-system-0dfe9332…`), thème **sombre** (`.theme-dark`).

Le nom affiché dans la maquette (« Ma ludothèque » / « Ludo », logo « L ») est remplacé par **Shelf** (logo « S »).

## Tokens

Copiés verbatim dans `src/renderer/src/styles/certflix-tokens.css`, exposés à Tailwind dans `app.css` :

| Usage                   | Token                                         | Classe Tailwind               |
| ----------------------- | --------------------------------------------- | ----------------------------- |
| Fond page               | `--surface-page` (ink-950 `#08080C`)          | `bg-page`                     |
| Sidebar                 | `--ink-900`                                   | `bg-ink-900`                  |
| Carte                   | `--ink-800`                                   | `bg-ink-800`                  |
| Bordure                 | `--ink-600` / `--ink-500`                     | `border-ink-600`              |
| Marque                  | `--brand` (red-400 `#FF3D57`), `--grad-brand` | `text-brand`, `bg-grad-brand` |
| Sélection active        | `--brand-subtle`                              | `bg-brand-subtle`             |
| Succès / installé       | `--green-300` `#12D18E`                       | `text-green-300`              |
| Avertissement / doublon | `--amber-300`                                 | `text-amber-300`              |
| Texte                   | `--text-hi` / `--text-mid` / `--text-lo`      | `text-text-hi` …              |

Polices (auto-hébergées, `src/renderer/src/assets/fonts/`) : **Space Grotesk** (titres, `font-display`),
**Plus Jakarta Sans** (texte, `font-body`), **JetBrains Mono** (chemins, compteurs, raccourcis, `font-mono`).
Rayons : cartes 14px (`rounded-md`), panneaux 20px (`rounded-lg`), chips `rounded-full`.

Composants du DS portés : `Button` (primary · accent · secondary · ghost · outline ; sm · md · lg), `Input` (label, hint, error).

## Écrans (1280×800)

| #   | Écran                               | Phase | Points clés                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | Bibliothèque — navigation hybride   | 1 → 4 | Sidebar 248px : logo, recherche `⌘K`, Bibliothèque/Favoris/Récents (compteurs mono), SOURCES (pastille verte + nombre), COLLECTIONS, Réglages en bas. Titre + « N jeux », barre « Filtrer ce qui est affiché… » (`/`), bascule grille ▦ / liste ☰, chips Tous · Installés · ♥ Favoris · Tag ▾. Grille 6 colonnes de jaquettes 3:4, rayon 14, titre sur dégradé bas, ♥ en haut à droite, sélection = anneau 3px brand + glow, non installé = opacité 0.4. |
| 02  | Palette de commandes `⌘K`           | 4     | Overlay flou, panneau 640px : saisie, résultats jeux (vignette, studio · temps, source, `↵ Jouer`), sections ALLER À / ACTIONS, pied « ↑↓ naviguer · ↵ lancer · Tab détail · / filtre ». Rail compact 68px possible.                                                                                                                                                                                                                                      |
| 03  | Détail du jeu — héros plein largeur | 4     | Héros 340px + dégradé vers la page, titre 64px, boutons Jouer (primary lg) · Dossier · Modifier · ♥ (secondary lg). Genres en chips, année · studio, description, tags (brand-subtle) + « + tag » pointillé, captures 16:10. Carte latérale 280px : TEMPS DE JEU, DERNIÈRE SESSION, SOURCE (pastille + état), chemin en mono.                                                                                                                             |
| 04  | Validation de l'import              | 2     | « À vérifier (N) » + « N correspondances automatiques OK ». Carte par exécutable : nom, chemin mono, badge (nouveau = vert, doublon Steam = ambre), choix de correspondance IGDB (sélection = bordure brand + glow), Importer / Ignorer ; doublon → Fusionner / Ignorer ; exclus (uninstall…) en pointillé avec « Restaurer ». CTA « Tout importer (N) ».                                                                                                 |
| 05  | Onboarding 1/3                      | 2     | Étapes Launchers → Métadonnées → Dossiers. « On a trouvé vos launchers » : cartes par launcher (détecté = bordure verte + glow + « ✓ Inclus », absent = pointillé 0.7), lien « Indiquer le dossier manuellement », Passer / Suivant →. Fond `--grad-hero`.                                                                                                                                                                                                |
| 06  | Collections et tags                 | 4     | Sidebar collections + TAGS (chips), en-tête collection + Renommer / Supprimer, bascule Manuelle / Intelligente (règles), grille 5 colonnes + tuile « + ». Glisser une jaquette sur une collection.                                                                                                                                                                                                                                                        |
| 07  | Menu contextuel                     | 4     | Clic droit sur jaquette : Jouer · Favori · Ouvrir le dossier · Masquer, TAGS (chips actifs en brand), « nouveau tag… ↵ », COLLECTIONS en cases à cocher.                                                                                                                                                                                                                                                                                                  |
| 08  | Réglages — métadonnées et clés API  | 3     | Nav : Métadonnées · Launchers · Dossiers et exclusions · Apparence · Raccourcis · Cache. Cartes IGDB (Client ID, Secret, « ✓ connecté », Tester la connexion), SteamGridDB (Clé API + Tester). Pied : « Clés chiffrées par le système, jamais affichées en clair » + taille du cache · Vider.                                                                                                                                                             |

Raccourcis visés : `Ctrl/⌘K` palette, `/` filtre, `↑↓` / `↵` navigation et lancement, `Tab` détail.
