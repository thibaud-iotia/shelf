import { BrowserWindow } from 'electron'
import { paths, type LauncherLocations } from '../platform/paths'
import { epicLauncherProvider } from './epic-launcher'
import { gogGalaxyProvider } from './gog-galaxy'
import { openGogLogin } from './gog-login'
import { gogOAuthProvider } from './gog-oauth'
import { itchProvider } from './itch'
import { rockstarBrowser } from './rockstar-browser'
import { rockstarSocialProvider } from './rockstar-social'
import { steamProvider } from './steam'
import type { AccountProvider } from './types'

export function createProviders(locations: () => LauncherLocations): AccountProvider[] {
  return [
    steamProvider() as AccountProvider,
    itchProvider() as AccountProvider,
    gogGalaxyProvider(() => locations().galaxyDatabases),
    gogOAuthProvider({ login: () => openGogLogin(BrowserWindow.getAllWindows()[0]) }),
    epicLauncherProvider(() => locations().epicCatalogCaches),
    rockstarSocialProvider({
      browser: rockstarBrowser({
        parent: () => BrowserWindow.getAllWindows()[0],
        logFile: paths.rockstarSocialLog()
      })
    })
  ]
}
