import { useAppInfo, usePing } from '@renderer/lib/queries'

// Mockup 08 — settings layout. Phase 0 only shows the "À propos" diagnostics card.

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold tracking-[.12em] text-text-lo">{label}</span>
      <span data-testid={testId} className="font-mono text-xs text-text-hi break-all select-text">
        {value}
      </span>
    </div>
  )
}

export function SettingsView() {
  const ping = usePing()
  const info = useAppInfo()

  return (
    <section className="flex-1 flex flex-col gap-5 px-12 py-8 max-w-[800px]">
      <h1 className="font-display font-bold text-[30px] tracking-[-.02em] text-text-hi">
        Réglages
      </h1>

      <div className="flex flex-col gap-4 p-6 rounded-lg bg-ink-800 border border-ink-600">
        <div className="flex items-center">
          <b className="font-display font-bold text-lg text-text-hi">À propos</b>
          <span
            data-testid="ipc-status"
            className={`ml-auto px-3 py-1 rounded-full text-[13px] font-semibold ${
              ping.isSuccess
                ? 'bg-accent-subtle text-green-300'
                : ping.isError
                  ? 'bg-brand-subtle text-red-300'
                  : 'text-text-lo'
            }`}
          >
            {ping.isSuccess ? '✓ IPC connecté' : ping.isError ? 'IPC indisponible' : '…'}
          </span>
        </div>

        {info.data && (
          <div className="grid grid-cols-2 gap-4">
            <Row label="VERSION" value={info.data.version} testId="app-version" />
            <Row label="ELECTRON" value={info.data.electronVersion} />
            <Row label="DONNÉES" value={info.data.userDataPath} />
            <Row
              label="MIGRATIONS APPLIQUÉES"
              value={String(info.data.appliedMigrations)}
              testId="applied-migrations"
            />
            <Row label="BASE DE DONNÉES" value={info.data.databasePath} />
          </div>
        )}
        {info.error && <p className="text-red-300">{info.error.message}</p>}
      </div>
    </section>
  )
}
