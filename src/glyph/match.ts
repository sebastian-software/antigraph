import { rasterizeGlyph } from './rasterize'

/**
 * Nearest-neighbour glyph matching against a clean font reference.
 *
 * The book's glyph outlines are coordinate-jittered per render chunk, so exact
 * matching is useless — but a jittered outline still rasterizes to almost the
 * same image as the canonical letter. Matching each book glyph to the closest
 * reference raster (sum of squared greyscale differences) recovers the
 * character deterministically, no OCR or model involved.
 */

export type GlyphReference = {
  /** The character(s) this reference glyph stands for, e.g. "a" or "fi". */
  label: string
  raster: Uint8Array
}

export type MatchResult = {
  label: string
  /**
   * Confidence as the ratio of the second-best to the best distance. 1 means a
   * tie (ambiguous); larger means the winner is clearly separated. `Infinity`
   * for an exact match.
   */
  margin: number
}

const REPLACEMENT = '�'

function sumSquaredDiff(a: Uint8Array, b: Uint8Array): number {
  let total = 0
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    total += diff * diff
  }
  return total
}

/** Pick the closest reference to `target`; report the separation margin. */
export function nearestReference(
  target: Uint8Array,
  references: GlyphReference[]
): MatchResult {
  let best = Number.POSITIVE_INFINITY
  let second = Number.POSITIVE_INFINITY
  let label = REPLACEMENT

  for (const reference of references) {
    const distance = sumSquaredDiff(target, reference.raster)
    if (distance < best) {
      second = best
      best = distance
      label = reference.label
    } else if (distance < second) {
      second = distance
    }
  }

  const margin = best > 0 ? second / best : Number.POSITIVE_INFINITY
  return { label, margin }
}

/** Rasterize one book glyph outline and match it against the reference set. */
export async function matchGlyphPath(
  path: string,
  unitsPerEm: number,
  references: GlyphReference[]
): Promise<MatchResult> {
  const raster = await rasterizeGlyph(path, unitsPerEm)
  return nearestReference(raster, references)
}
