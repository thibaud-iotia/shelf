import type { AppContext } from '../context'
import { broadcast } from '../events'
import { pickPath } from './dialogs'
import { handle } from './handle'

export function registerLibraryHandlers(ctx: AppContext): void {
  handle('launchers:list', () => ctx.importer.launchers())

  handle('import:scan', (options) => ctx.importer.scan(options ?? {}))

  handle('import:apply', (decisions) => {
    if (!Array.isArray(decisions)) return ctx.importer.apply([])
    const report = ctx.importer.apply(decisions)
    broadcast('library:changed', { reason: 'import' })
    return report
  })

  handle('import:pickFolder', () =>
    pickPath({ title: 'Choisir un dossier de jeux', properties: ['openDirectory'] })
  )
}
