// Rockstar Games Launcher catalogue. The launcher names its games by a title id (`gta5`,
// `rdr2`…): it is Shelf's sourceId, found in the uninstall entries the launcher writes
// (`uninstall.exe -uninstall=<titleId>`) and passed back to `Launcher.exe`.
// No runtime dependencies (shared by main and renderer).

export interface RockstarTitle {
  titleId: string
  /** Name shown by Shelf (the launcher's names change: "Grand Theft Auto V Legacy"…). */
  title: string
  /** Main executable, relative to the install folder (running state, folder scan). */
  executable: string
  /** Steam store appid of the same game: news, videos, reviews on the game page. */
  steamAppId: string | null
  /** Social Club's id in `gamesOwned` ("GTAV_PC"); null when not known. */
  socialClubTag: string | null
  /** Saves under `Documents\Rockstar Games\`, used as default when the folder exists. */
  saveFolder: string | null
  /** Page on rockstargames.com (`/games/<slug>`). */
  slug: string | null
}

export const ROCKSTAR_TITLES: readonly RockstarTitle[] = [
  {
    titleId: 'gta5',
    title: 'Grand Theft Auto V Legacy',
    executable: 'GTA5.exe',
    steamAppId: '271590',
    socialClubTag: 'GTAV_PC',
    saveFolder: 'GTA V\\Profiles',
    slug: 'V'
  },
  {
    titleId: 'gta5_gen9',
    title: 'Grand Theft Auto V Enhanced',
    executable: 'GTA5_Enhanced.exe',
    steamAppId: '3240220',
    socialClubTag: null,
    saveFolder: 'GTAV Enhanced\\Profiles',
    slug: 'V'
  },
  {
    titleId: 'rdr2',
    title: 'Red Dead Redemption 2',
    executable: 'RDR2.exe',
    steamAppId: '1174180',
    socialClubTag: 'RDR2_PC',
    saveFolder: 'Red Dead Redemption 2\\Profiles',
    slug: 'reddeadredemption2'
  },
  {
    titleId: 'rdr',
    title: 'Red Dead Redemption',
    executable: 'RDR.exe',
    steamAppId: '2668510',
    socialClubTag: null,
    saveFolder: null,
    slug: 'reddeadredemption'
  },
  {
    titleId: 'lanoire',
    title: 'L.A. Noire',
    executable: 'LANoire.exe',
    steamAppId: '110800',
    socialClubTag: 'LAN_PC',
    saveFolder: null,
    slug: 'lanoire'
  },
  {
    titleId: 'lanoirevr',
    title: 'L.A. Noire: The VR Case Files',
    executable: 'LANoireVR.exe',
    steamAppId: '722230',
    socialClubTag: 'LANVR_PC',
    saveFolder: null,
    slug: 'lanoirevrcasefiles'
  },
  {
    titleId: 'mp3',
    title: 'Max Payne 3',
    executable: 'MaxPayne3.exe',
    steamAppId: '204100',
    socialClubTag: 'MP3_PC',
    saveFolder: 'Max Payne 3\\Profiles',
    slug: 'maxpayne3'
  },
  {
    titleId: 'gta4',
    title: 'Grand Theft Auto IV: The Complete Edition',
    executable: 'GTAIV.exe',
    steamAppId: '12210',
    socialClubTag: 'GTAIV_PC',
    saveFolder: 'GTA IV\\savegames',
    slug: 'IV'
  },
  {
    titleId: 'gta3',
    title: 'Grand Theft Auto III',
    executable: 'gta3.exe',
    steamAppId: '12100',
    socialClubTag: 'GTAIII_PC',
    saveFolder: null,
    slug: null
  },
  {
    titleId: 'gtavc',
    title: 'Grand Theft Auto: Vice City',
    executable: 'gta-vc.exe',
    steamAppId: '12110',
    socialClubTag: 'GTAVC_PC',
    saveFolder: null,
    slug: null
  },
  {
    titleId: 'gtasa',
    title: 'Grand Theft Auto: San Andreas',
    executable: 'gta_sa.exe',
    steamAppId: '12120',
    socialClubTag: 'GTASA_PC',
    saveFolder: null,
    slug: null
  },
  {
    titleId: 'gta3unreal',
    title: 'Grand Theft Auto III – The Definitive Edition',
    executable: 'Gameface\\Binaries\\Win64\\LibertyCity.exe',
    steamAppId: '1546970',
    socialClubTag: null,
    saveFolder: null,
    slug: 'gta-trilogy'
  },
  {
    titleId: 'gtavcunreal',
    title: 'Grand Theft Auto: Vice City – The Definitive Edition',
    executable: 'Gameface\\Binaries\\Win64\\ViceCity.exe',
    steamAppId: '1546990',
    socialClubTag: null,
    saveFolder: null,
    slug: 'gta-trilogy'
  },
  {
    titleId: 'gtasaunreal',
    title: 'Grand Theft Auto: San Andreas – The Definitive Edition',
    executable: 'Gameface\\Binaries\\Win64\\SanAndreas.exe',
    steamAppId: '1547000',
    socialClubTag: null,
    saveFolder: null,
    slug: 'gta-trilogy'
  },
  {
    titleId: 'bully',
    title: 'Bully: Scholarship Edition',
    executable: 'Bully.exe',
    steamAppId: '12200',
    socialClubTag: 'Bully_PC',
    saveFolder: null,
    slug: 'bully'
  }
]

const BY_ID = new Map(ROCKSTAR_TITLES.map((t) => [t.titleId, t]))

/** Title ids are plain identifiers: anything else never reaches `Launcher.exe`. */
export const ROCKSTAR_TITLE_ID = /^[a-z0-9_]{1,40}$/i

export function rockstarTitle(titleId: string): RockstarTitle | null {
  return BY_ID.get(titleId.toLowerCase()) ?? null
}

/** Social Club tag ("GTAV_PC", any case) to the launcher's title; null when unknown. */
export function rockstarTitleByTag(tag: string): RockstarTitle | null {
  const wanted = tag.trim().toLowerCase()
  return ROCKSTAR_TITLES.find((t) => t.socialClubTag?.toLowerCase() === wanted) ?? null
}
