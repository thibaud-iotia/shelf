import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { AppError } from '../../shared/errors'

/** Electron's safeStorage in the app; a fake in tests. */
export interface Cipher {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

/**
 * API keys and tokens, encrypted by the OS (DPAPI, Keychain, libsecret) and kept in
 * their own file. The database only stores the reference (`credentialsRef`).
 */
export class SecretStore {
  constructor(
    private readonly file: string,
    private readonly cipher: Cipher
  ) {}

  available(): boolean {
    return this.cipher.isAvailable()
  }

  private read(): Record<string, string> {
    if (!existsSync(this.file)) return {}
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>
    } catch {
      return {}
    }
  }

  private write(data: Record<string, string>): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  has(ref: string): boolean {
    return Object.hasOwn(this.read(), ref)
  }

  get(ref: string): string | null {
    const blob = this.read()[ref]
    if (!blob || !this.cipher.isAvailable()) return null
    try {
      return this.cipher.decrypt(Buffer.from(blob, 'base64'))
    } catch {
      return null
    }
  }

  set(ref: string, value: string): void {
    if (!this.cipher.isAvailable()) {
      throw new AppError(
        'UNAVAILABLE',
        'Le chiffrement du système est indisponible : la clé ne peut pas être enregistrée.'
      )
    }
    const data = this.read()
    data[ref] = this.cipher.encrypt(value).toString('base64')
    this.write(data)
  }

  delete(ref: string): void {
    const data = this.read()
    if (!Object.hasOwn(data, ref)) return
    delete data[ref]
    this.write(data)
  }

  /** Total of what is stored, for diagnostics (never the values). */
  refs(): string[] {
    return Object.keys(this.read())
  }
}
