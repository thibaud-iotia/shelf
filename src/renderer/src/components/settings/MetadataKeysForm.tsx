import { useState, type FormEvent } from 'react'
import type { ApiKeyService, ConnectionTest } from '@shared/models'
import { Button } from '@renderer/components/ui/Button'
import { Input } from '@renderer/components/ui/Input'
import { useClearKeys, useSetKeys, useSettings, useTestKey } from '@renderer/lib/queries'
import { toast } from '@renderer/stores/toasts'

// Mockup 08 — IGDB and SteamGridDB cards. Stored keys are never sent back to the
// renderer: a configured field shows dots, typing replaces the stored value.

const MASK = '••••••••••••••••'

function TestResult({ result }: { result: ConnectionTest | undefined }) {
  if (!result) return null
  return (
    <span role="status" className={`text-sm ${result.ok ? 'text-green-300' : 'text-red-300'}`}>
      {result.message}
    </span>
  )
}

function KeyCard({
  service,
  title,
  configured,
  fields,
  compact
}: {
  service: ApiKeyService
  title: string
  configured: boolean
  fields: {
    name: 'igdbClientId' | 'igdbClientSecret' | 'steamGridDbKey'
    label: string
    hint?: string
  }[]
  compact?: boolean
}) {
  const setKeys = useSetKeys()
  const clearKeys = useClearKeys()
  const test = useTestKey()
  const [values, setValues] = useState<Record<string, string>>({})
  const dirty = Object.values(values).some((v) => v.trim())

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!dirty) return
    await setKeys.mutateAsync(values)
    setValues({})
    toast.success(`${title} : clés enregistrées`)
  }

  return (
    <form
      onSubmit={save}
      data-testid={`keys-${service}`}
      className={`flex flex-col gap-4 rounded-lg bg-ink-800 border border-ink-600 ${compact ? 'p-5' : 'p-6'}`}
    >
      <div className="flex items-center gap-3">
        <b className="font-display font-bold text-lg text-text-hi">{title}</b>
        <span
          data-testid={`keys-${service}-status`}
          className={`ml-auto px-3 py-1 rounded-full text-[13px] font-semibold ${
            configured ? 'bg-accent-subtle text-green-300' : 'bg-ink-700 text-text-lo'
          }`}
        >
          {configured ? '✓ configuré' : 'non configuré'}
        </span>
      </div>
      <div className={compact ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-3'}>
        {fields.map((f) => (
          <Input
            key={f.name}
            label={f.label}
            hint={f.hint}
            type="password"
            autoComplete="off"
            placeholder={configured ? MASK : ''}
            value={values[f.name] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          />
        ))}
      </div>
      <div className="flex items-center gap-2.5">
        {dirty && (
          <Button type="submit" disabled={setKeys.isPending}>
            Enregistrer
          </Button>
        )}
        <Button
          variant="outline"
          disabled={!configured || test.isPending}
          onClick={() => test.mutate(service)}
        >
          {test.isPending ? 'Test…' : service === 'igdb' ? 'Tester la connexion' : 'Tester'}
        </Button>
        {configured && !compact && (
          <Button variant="ghost" onClick={() => clearKeys.mutate(service)}>
            Oublier
          </Button>
        )}
        <TestResult result={test.data} />
      </div>
    </form>
  )
}

export function MetadataKeysForm({ compact = false }: { compact?: boolean }) {
  const settings = useSettings()
  if (!settings.data) return null
  const { igdbConfigured, steamGridDbConfigured, secretsAvailable } = settings.data
  return (
    <div className="flex flex-col gap-4">
      {!secretsAvailable && (
        <p role="alert" className="text-sm text-amber-300">
          Le chiffrement du système est indisponible : les clés ne peuvent pas être enregistrées.
        </p>
      )}
      <KeyCard
        service="igdb"
        title="IGDB (Twitch)"
        configured={igdbConfigured}
        compact={compact}
        fields={[
          {
            name: 'igdbClientId',
            label: 'Client ID',
            hint: 'dev.twitch.tv › Console › Applications'
          },
          { name: 'igdbClientSecret', label: 'Secret' }
        ]}
      />
      <KeyCard
        service="steamgriddb"
        title="SteamGridDB"
        configured={steamGridDbConfigured}
        compact={compact}
        fields={[
          { name: 'steamGridDbKey', label: 'Clé API', hint: 'steamgriddb.com › Préférences › API' }
        ]}
      />
    </div>
  )
}
