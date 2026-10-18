import { useState, type FormEvent, type ReactNode } from 'react'
import { formatDay, pluralize } from '@shared/format'
import type { Account, AccountKind, ConnectInput } from '@shared/models'
import { Button } from '@renderer/components/ui/Button'
import { Input } from '@renderer/components/ui/Input'
import {
  useAccounts,
  useConnectAccount,
  useDisconnectAccount,
  useSettings,
  useSyncAccounts,
  useUpdateSettings
} from '@renderer/lib/queries'
import { toast } from '@renderer/stores/toasts'
import { Card, SectionTitle, StatusPill, Toggle } from './common'

function AccountRow({ account }: { account: Account }) {
  const sync = useSyncAccounts()
  const disconnect = useDisconnectAccount()
  const [confirm, setConfirm] = useState(false)

  const resync = async () => {
    const [report] = await sync.mutateAsync([account.id])
    if (report?.error) toast.error(report.error)
    else if (report)
      toast.success(`${account.displayName} : ${pluralize(report.total, 'jeu', 'jeux')}`)
  }

  return (
    <div data-testid={`account-${account.kind}`} className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <i
          className={`w-2 h-2 rounded-full ${account.lastError ? 'bg-amber-300' : 'bg-green-300'}`}
        />
        <b className="text-text-hi">{account.displayName}</b>
        <span className="text-sm text-text-lo">
          {pluralize(account.gameCount, 'jeu possédé', 'jeux possédés')} ·{' '}
          {account.lastSyncAt
            ? `synchronisé ${formatDay(account.lastSyncAt).toLowerCase()}`
            : 'jamais synchronisé'}
        </span>
        <span className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" disabled={sync.isPending} onClick={resync}>
            {sync.isPending ? 'Synchronisation…' : 'Resynchroniser'}
          </Button>
          {confirm ? (
            <Button variant="outline" size="sm" onClick={() => disconnect.mutate([account.id])}>
              Confirmer
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
              Déconnecter
            </Button>
          )}
        </span>
      </div>
      {account.lastError && (
        <p role="alert" className="text-sm text-amber-300">
          ⚠ {account.lastError}
        </p>
      )}
    </div>
  )
}

function ProviderCard({
  kind,
  title,
  description,
  accounts,
  children
}: {
  kind: AccountKind
  title: string
  description: ReactNode
  accounts: Account[]
  children: ReactNode
}) {
  const mine = accounts.filter((a) => a.kind === kind)
  return (
    <Card
      title={title}
      testId={`provider-${kind}`}
      status={
        <StatusPill ok={mine.length > 0}>{mine.length ? '✓ connecté' : 'non connecté'}</StatusPill>
      }
    >
      <p className="text-sm text-text-mid">{description}</p>
      {mine.map((a) => (
        <AccountRow key={a.id} account={a} />
      ))}
      {mine.length === 0 && children}
    </Card>
  )
}

function useConnect() {
  const connect = useConnectAccount()
  const [error, setError] = useState<string | null>(null)
  const run = async (input: ConnectInput) => {
    setError(null)
    try {
      const { account, sync } = await connect.mutateAsync([input])
      if (sync.error) toast.error(sync.error)
      else
        toast.success(`${account.displayName} connecté : ${pluralize(sync.total, 'jeu', 'jeux')}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return { run, error, isPending: connect.isPending }
}

function SteamForm() {
  const { run, error, isPending } = useConnect()
  const [apiKey, setApiKey] = useState('')
  const [steamId, setSteamId] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run({ kind: 'steam', apiKey, steamId })
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input
        label="Clé API Steam"
        type="password"
        autoComplete="off"
        hint="À créer sur steamcommunity.com/dev/apikey"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      <Input
        label="SteamID64 ou URL du profil"
        placeholder="https://steamcommunity.com/id/…"
        value={steamId}
        onChange={(e) => setSteamId(e.target.value)}
      />
      <p className="text-xs text-amber-300">
        « Détails des jeux » doit être public dans la confidentialité du profil Steam, sinon la
        liste revient vide.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Connexion…' : 'Connecter Steam'}
        </Button>
      </div>
    </form>
  )
}

function ItchForm() {
  const { run, error, isPending } = useConnect()
  const [apiKey, setApiKey] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void run({ kind: 'itch', apiKey })
      }}
      className="flex flex-col gap-3"
    >
      <Input
        label="Clé API itch.io"
        type="password"
        autoComplete="off"
        hint="itch.io › Paramètres › Clés API"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Connexion…' : 'Connecter itch.io'}
        </Button>
      </div>
    </form>
  )
}

function ConnectButton({ input, label }: { input: ConnectInput; label: string }) {
  const { run, error, isPending } = useConnect()
  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <div>
        <Button disabled={isPending} onClick={() => void run(input)}>
          {isPending ? 'Connexion…' : label}
        </Button>
      </div>
    </div>
  )
}

export function AccountsSection() {
  const accounts = useAccounts()
  const settings = useSettings()
  const update = useUpdateSettings()
  const syncAll = useSyncAccounts()
  const list = accounts.data ?? []

  return (
    <>
      <div className="flex items-start">
        <SectionTitle hint="Affiche aussi les jeux possédés mais non installés, avec un bouton Installer. Synchronisation automatique au démarrage si la dernière date de plus de 24 h.">
          Comptes
        </SectionTitle>
        {list.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto flex-none"
            disabled={syncAll.isPending}
            onClick={() => syncAll.mutate([undefined])}
          >
            Tout synchroniser
          </Button>
        )}
      </div>

      <ProviderCard
        kind="steam"
        title="Steam"
        accounts={list}
        description="API officielle Steam Web API. Le temps de jeu Steam est affiché à part du temps mesuré par Shelf."
      >
        <SteamForm />
      </ProviderCard>

      <ProviderCard
        kind="gog-galaxy"
        title="GOG Galaxy (local)"
        accounts={list}
        description="Lit la base locale de GOG Galaxy 2.0 : aucun identifiant, aucune connexion réseau."
      >
        <ConnectButton input={{ kind: 'gog-galaxy' }} label="Lire la bibliothèque GOG Galaxy" />
      </ProviderCard>

      <ProviderCard
        kind="gog-oauth"
        title="Compte GOG (non officiel)"
        accounts={list}
        description="Connexion au compte GOG comme le fait Heroic. Intégration non officielle, isolée : si elle casse, le reste de Shelf continue de fonctionner."
      >
        {settings.data && (
          <Toggle
            label="Activer la connexion au compte GOG"
            checked={settings.data.gogOAuthEnabled}
            onChange={(value) => update.mutate({ gogOAuthEnabled: value })}
          />
        )}
        {settings.data?.gogOAuthEnabled && (
          <ConnectButton input={{ kind: 'gog-oauth' }} label="Se connecter à GOG…" />
        )}
      </ProviderCard>

      <ProviderCard
        kind="epic-legendary"
        title="Epic Games (via Legendary)"
        accounts={list}
        description="Shelf n’implémente pas l’authentification Epic : il lit la bibliothèque de Legendary ou Heroic, une fois connecté là-bas."
      >
        <ConnectButton input={{ kind: 'epic-legendary' }} label="Utiliser Legendary" />
      </ProviderCard>

      <ProviderCard
        kind="itch"
        title="itch.io"
        accounts={list}
        description="Clés de jeux possédées, via l’API itch.io."
      >
        <ItchForm />
      </ProviderCard>
    </>
  )
}
