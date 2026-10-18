import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import type { Game } from '../shared/models'
import { paths } from './platform/paths'

// Phase 5 "confort": tray icon, close-to-tray, launch at login.

export const HIDDEN_ARG = '--hidden'

/** Linux XDG autostart entry for the AppImage / deb install. */
export function autostartDesktopEntry(exec: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Shelf',
    `Exec="${exec}" ${HIDDEN_ARG}`,
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n')
}

/**
 * Registers (or removes) Shelf at session start. Only the installed app does it: in
 * development it would register the bare Electron binary.
 */
export function applyLaunchAtStartup(enabled: boolean): boolean {
  if (!app.isPackaged) return false
  if (process.platform === 'linux') {
    const file = paths.autostartEntry()
    if (enabled) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, autostartDesktopEntry(process.env.APPIMAGE ?? process.execPath))
    } else {
      rmSync(file, { force: true })
    }
    return true
  }
  app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? [HIDDEN_ARG] : [] })
  return true
}

export function startedHidden(): boolean {
  return process.argv.includes(HIDDEN_ARG)
}

interface TrayDeps {
  show: () => void
  recentGames: () => Game[]
  play: (gameId: number) => void
  quit: () => void
}

/** System tray icon with quick access to the recently played games. */
export class ShelfTray {
  private tray: Tray | null = null

  constructor(private readonly deps: TrayDeps) {}

  create(): void {
    const image = nativeImage.createFromPath(paths.trayIcon())
    if (process.platform === 'darwin') image.setTemplateImage(true)
    this.tray = new Tray(image)
    this.tray.setToolTip('Shelf')
    this.tray.on('click', () => this.deps.show())
    this.refresh()
  }

  refresh(): void {
    if (!this.tray) return
    const recent = this.deps.recentGames()
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Ouvrir Shelf', click: () => this.deps.show() },
        { type: 'separator' },
        ...(recent.length
          ? recent.map((g) => ({ label: `Jouer à ${g.title}`, click: () => this.deps.play(g.id) }))
          : [{ label: 'Aucun jeu récent', enabled: false }]),
        { type: 'separator' },
        { label: 'Quitter Shelf', click: () => this.deps.quit() }
      ])
    )
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}

export function showMainWindow(create: () => BrowserWindow): void {
  const window = BrowserWindow.getAllWindows()[0] ?? create()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
