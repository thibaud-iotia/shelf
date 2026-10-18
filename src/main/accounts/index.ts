import { BrowserWindow } from 'electron'
import type { LauncherLocations } from '../platform/paths'
import { epicLegendaryProvider } from './epic-legendary'
import { gogGalaxyProvider } from './gog-galaxy'
import { openGogLogin } from './gog-login'
import { gogOAuthProvider } from './gog-oauth'
import { itchProvider } from './itch'
import { steamProvider } from './steam'
import type { AccountProvider } from './types'

export function createProviders(locations: () => LauncherLocations): AccountProvider[] {
  return [
    steamProvider() as AccountProvider,
    itchProvider() as AccountProvider,
    gogGalaxyProvider(() => locations().galaxyDatabases),
    gogOAuthProvider({ login: () => openGogLogin(BrowserWindow.getAllWindows()[0]) }),
    epicLegendaryProvider(() => locations().legendaryBinaries)
  ]
}
