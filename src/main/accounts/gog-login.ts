import { BrowserWindow, session } from 'electron'
import { AppError } from '../../shared/errors'
import { codeFromRedirect, GOG_AUTH_URL } from './gog-oauth'

/**
 * Dedicated login window for GOG option B: an isolated, non-persistent session with no
 * preload. Resolves with the authorization code once GOG redirects to on_login_success.
 */
export function openGogLogin(parent?: BrowserWindow): Promise<string> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      parent,
      modal: !!parent,
      width: 460,
      height: 720,
      title: 'Connexion à GOG',
      autoHideMenuBar: true,
      webPreferences: {
        session: session.fromPartition('gog-login'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    let settled = false
    const finish = (code: string | null) => {
      if (settled) return
      settled = true
      if (code) resolve(code)
      else reject(new AppError('AUTH', 'Connexion GOG annulée.'))
      if (!win.isDestroyed()) win.close()
    }
    const check = (url: string) => {
      const code = codeFromRedirect(url)
      if (code) finish(code)
    }
    win.webContents.on('will-redirect', (_e, url) => check(url))
    win.webContents.on('did-navigate', (_e, url) => check(url))
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.on('closed', () => finish(null))
    void win.loadURL(GOG_AUTH_URL)
  })
}
