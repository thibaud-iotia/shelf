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

  handle('accounts:list', () => ctx.accounts.list())
  handle('accounts:connect', async (input) => {
    const result = await ctx.accounts.connect(input)
    broadcast('library:changed', { reason: 'sync' })
    ctx.onSynced()
    return result
  })
  handle('accounts:disconnect', (id) => {
    ctx.accounts.disconnect(String(id))
    return null
  })
  handle('accounts:sync', async (id) => {
    const reports = id ? [await ctx.accounts.sync(String(id))] : await ctx.accounts.syncAll()
    broadcast('library:changed', { reason: 'sync' })
    ctx.onSynced()
    return reports
  })

  handle('import:pickFolder', () =>
    pickPath({ title: 'Choisir un dossier de jeux', properties: ['openDirectory'] })
  )
}
