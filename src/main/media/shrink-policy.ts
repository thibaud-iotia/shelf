// Artwork is stored at the size Shelf displays, not as downloaded: SteamGridDB serves the
// original files (heroes of several MB, logos up to 15 MB) for images shown a few hundred
// pixels wide. Pure rules here; the Electron implementation is in `shrink.ts`.

export type ImageKind = 'cover' | 'hero' | 'logo' | 'shot'

export interface ShrunkImage {
  data: Uint8Array
  extension: '.jpg' | '.png'
}

/** Re-encodes an image for its use, or null to keep the original bytes. */
export type ImageShrinker = (data: Uint8Array, kind: ImageKind) => Promise<ShrunkImage | null>

interface KindRule {
  maxWidth: number
  maxHeight: number
  /** Logos need their transparency: always PNG. Others: JPEG unless they have transparency. */
  png: boolean
  /** Files under this size are left alone when compacting the existing cache. */
  compactAbove: number
}

export const IMAGE_RULES: Record<ImageKind, KindRule> = {
  // Grid cards and the cover of the game page (2× a 300 px card).
  cover: { maxWidth: 600, maxHeight: 900, png: false, compactAbove: 200_000 },
  // Banner of the game page: full window width.
  hero: { maxWidth: 1920, maxHeight: 1080, png: false, compactAbove: 450_000 },
  logo: { maxWidth: 800, maxHeight: 400, png: true, compactAbove: 250_000 },
  shot: { maxWidth: 1280, maxHeight: 720, png: false, compactAbove: 400_000 }
}

export const JPEG_QUALITY = 85

/** Largest size within the rule's box, aspect ratio kept; null when it already fits. */
export function fitWithin(
  width: number,
  height: number,
  kind: ImageKind
): { width: number; height: number } | null {
  const { maxWidth, maxHeight } = IMAGE_RULES[kind]
  if (width <= 0 || height <= 0) return null
  const scale = Math.min(maxWidth / width, maxHeight / height)
  if (scale >= 1) return null
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

/** Output format: PNG for logos and transparent images, JPEG otherwise. */
export function outputFormat(kind: ImageKind, hasTransparency: boolean): 'png' | 'jpeg' {
  return IMAGE_RULES[kind].png || hasTransparency ? 'png' : 'jpeg'
}

/** Whether a BGRA/RGBA bitmap has a pixel that is not fully opaque (alpha is the 4th byte). */
export function hasTransparency(bitmap: Uint8Array): boolean {
  for (let i = 3; i < bitmap.length; i += 4) if (bitmap[i] !== 255) return true
  return false
}
