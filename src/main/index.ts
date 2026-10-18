import { app, BrowserWindow, dialog } from 'electron'
import { openDatabase, type DatabaseHandle } from './db/client'
import { registerIpcHandlers } from './ipc/handlers'
import { applyUserDataOverride, paths } from './platform/paths'
import { createMainWindow } from './window'

app.setName('Shelf')
applyUserDataOverride()
app.enableSandbox()

let database: DatabaseHandle | undefined

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  app
    .whenReady()
    .then(() => {
      database = openDatabase(paths.database(), paths.migrations())
      registerIpcHandlers(database)
      createMainWindow()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
      })
    })
    .catch((error: unknown) => {
      console.error('[startup] fatal', error)
      dialog.showErrorBox(
        'Shelf ne peut pas démarrer',
        error instanceof Error ? error.message : String(error)
      )
      app.exit(1)
    })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  database?.close()
})
