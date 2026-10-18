import { create } from 'zustand'
import type { ImportAction, ImportCandidate, ImportDecision, ScanResult } from '@shared/models'

// State of the "jeux détectés" review screen (mockup 04) between the scan and the import.

interface Choice {
  action: ImportAction
  /** true once the user clicked Importer / Fusionner / Ignorer on the card. */
  confirmed: boolean
  title?: string
  igdbId?: number | null
}

interface ImportState {
  result: ScanResult | null
  choices: Record<string, Choice>
  /** Excluded executables the user restored (shown as new finds). */
  restored: string[]
  setResult: (result: ScanResult | null) => void
  choose: (key: string, choice: Partial<Choice>) => void
  restore: (key: string) => void
  reset: () => void
}

export function defaultAction(candidate: ImportCandidate): ImportAction {
  if (candidate.status === 'excluded') return 'ignore'
  return candidate.status === 'duplicate' ? 'merge' : 'import'
}

export const useImportStore = create<ImportState>()((set) => ({
  result: null,
  choices: {},
  restored: [],
  setResult: (result) => set({ result, choices: {}, restored: [] }),
  choose: (key, choice) =>
    set((s) => ({
      choices: {
        ...s.choices,
        [key]: { action: 'import', confirmed: false, ...s.choices[key], ...choice }
      }
    })),
  restore: (key) => set((s) => ({ restored: [...s.restored, key] })),
  reset: () => set({ result: null, choices: {}, restored: [] })
}))

/** Candidate list with restored exclusions turned into new finds to review. */
export function effectiveCandidates(result: ScanResult, restored: string[]): ImportCandidate[] {
  return result.candidates.map((c) =>
    c.status === 'excluded' && restored.includes(c.key)
      ? { ...c, status: 'new', excludedReason: null }
      : c
  )
}

export function buildDecisions(
  candidates: ImportCandidate[],
  choices: Record<string, Choice>
): ImportDecision[] {
  return candidates
    .filter((c) => c.status !== 'excluded')
    .map((c) => {
      const choice = choices[c.key]
      return {
        key: c.key,
        action: choice?.action ?? defaultAction(c),
        ...(choice?.title ? { title: choice.title } : {}),
        ...(choice?.igdbId !== undefined ? { igdbId: choice.igdbId } : {})
      }
    })
}
