import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Bytes a process wrote since it started; its counter starts over with a new process. */
export interface ProcessWriteSample {
  pid: number
  written: number
}

export interface ProcessWriteMeter {
  /** The process's write counter now; null when it is not running or cannot be read. */
  sample(): Promise<ProcessWriteSample | null>
  /** Stops the helper process, if any (a later sample starts it again). */
  stop(): void
}

// Windows: GetProcessIoCounters through a PowerShell helper started once and asked on stdin,
// so a sample costs a line, not a process. Language-independent (no performance counters).
const WINDOWS_HELPER = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class ShelfIo {
  [StructLayout(LayoutKind.Sequential)] public struct C { public ulong r, w, o, rb, wb, ob; }
  [DllImport("kernel32.dll")] static extern bool GetProcessIoCounters(IntPtr h, out C c);
  public static string Written(string name) {
    foreach (var p in System.Diagnostics.Process.GetProcessesByName(name)) {
      try { C c; if (GetProcessIoCounters(p.Handle, out c)) return p.Id + " " + c.wb; }
      catch { } finally { p.Dispose(); }
    }
    return "-";
  }
}
"@
while ($null -ne ($name = [Console]::In.ReadLine())) { [Console]::Out.WriteLine([ShelfIo]::Written($name)) }
`

// The script goes on the command line (UTF-16LE base64): stdin is left to the names asked.
const ENCODED_HELPER = Buffer.from(WINDOWS_HELPER.trim(), 'utf16le').toString('base64')

/** "<pid> <bytes>" from the helper; null for "-" or anything else. */
export function parseWriteLine(line: string): ProcessWriteSample | null {
  const match = /^(\d+) (\d+)$/.exec(line.trim())
  return match ? { pid: Number(match[1]), written: Number(match[2]) } : null
}

/** `write_bytes` of /proc/<pid>/io (bytes sent to storage). */
export function parseProcIo(text: string): number | null {
  const match = /^write_bytes:\s*(\d+)$/m.exec(text)
  return match ? Number(match[1]) : null
}

class WindowsWriteMeter implements ProcessWriteMeter {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private readonly waiting: ((line: string | null) => void)[] = []
  private broken = false

  constructor(private readonly name: string) {}

  sample(): Promise<ProcessWriteSample | null> {
    const child = this.start()
    if (!child) return Promise.resolve(null)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // No answer: the helper is stuck; the next sample starts a new one.
        this.stop()
        resolve(null)
      }, 5_000)
      this.waiting.push((line) => {
        clearTimeout(timer)
        resolve(line === null ? null : parseWriteLine(line))
      })
      child.stdin.write(`${this.name}\n`)
    })
  }

  stop(): void {
    const child = this.child
    this.child = null
    this.buffer = ''
    for (const resolve of this.waiting.splice(0)) resolve(null)
    child?.kill()
  }

  private start(): ChildProcessWithoutNullStreams | null {
    if (this.child) return this.child
    if (this.broken) return null
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_HELPER],
        { windowsHide: true }
      )
    } catch {
      this.broken = true
      return null
    }
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let end: number
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end)
        this.buffer = this.buffer.slice(end + 1)
        this.waiting.shift()?.(line)
      }
    })
    child.stderr.resume()
    child.on('error', () => {
      this.broken = true
      if (this.child === child) this.stop()
    })
    child.on('exit', (code) => {
      // Exiting on its own before any answer: PowerShell refuses the helper (policy).
      if (code !== null && code !== 0 && this.waiting.length) this.broken = true
      if (this.child === child) this.stop()
    })
    return child
  }
}

class LinuxWriteMeter implements ProcessWriteMeter {
  private pid: number | null = null

  constructor(private readonly name: string) {}

  async sample(): Promise<ProcessWriteSample | null> {
    const pid = (await this.alive(this.pid)) ? this.pid : await this.find()
    this.pid = pid
    if (pid === null) return null
    try {
      const written = parseProcIo(await readFile(join('/proc', String(pid), 'io'), 'utf8'))
      return written === null ? null : { pid, written }
    } catch {
      return null
    }
  }

  stop(): void {
    this.pid = null
  }

  private async alive(pid: number | null): Promise<boolean> {
    if (pid === null) return false
    try {
      return (await readFile(join('/proc', String(pid), 'comm'), 'utf8')).trim() === this.name
    } catch {
      return false
    }
  }

  private async find(): Promise<number | null> {
    try {
      for (const entry of await readdir('/proc')) {
        if (/^\d+$/.test(entry) && (await this.alive(Number(entry)))) return Number(entry)
      }
    } catch {
      // No /proc.
    }
    return null
  }
}

const none: ProcessWriteMeter = { sample: async () => null, stop: () => {} }

/** Write counter of the process named `name` (Windows, Linux); never anything on macOS. */
export function processWriteMeter(
  name: string,
  platform: NodeJS.Platform = process.platform
): ProcessWriteMeter {
  if (platform === 'win32') return new WindowsWriteMeter(name)
  if (platform === 'linux') return new LinuxWriteMeter(name)
  return none
}
