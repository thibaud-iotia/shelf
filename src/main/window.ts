import { BrowserWindow, shell } from 'electron'
import { paths } from './platform/paths'

export const WINDOW_TITLE = 'Shelf'

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: WINDOW_TITLE,
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#08080C',
    autoHideMenuBar: true,
    webPreferences: {
      preload: paths.preload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  window.once('ready-to-show', () => window.show())

  // Keep the HTML <title> from overriding the window title.
  window.on('page-title-updated', (event) => event.preventDefault())

  // Never navigate the app window away; open http(s) links in the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env.ELECTRON_RENDERER_URL
    if (!devServer || !url.startsWith(devServer)) event.preventDefault()
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) void window.loadURL(devServer)
  else void window.loadFile(paths.rendererHtml())

  return window
}
