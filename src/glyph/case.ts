/**
 * Case disambiguation for shape-identical letters.
 *
 * When a glyph outline is rendered in isolation for identification, letters
 * whose upper- and lower-case forms differ *only in size* (o/O, s/S, v/V, …)
 * are indistinguishable by shape. Their case is recoverable from the glyph's
 * ascent: a capital reaches cap-height (~0.7em) while the lower-case body only
 * reaches x-height (~0.5em). We resolve the letter shape with OCR and the case
 * with this metric.
 *
 * Excluded on purpose: `k` (its lower-case form is an ascender, as tall as `K`)
 * and digit/letter pairs like `0`/`O` — those need the recognizer's own size
 * signal, not ascent alone.
 */

/** Letters whose case is size-only and reliably split by ascent height. */
const SHAPE_AMBIGUOUS = new Set(['c', 'o', 's', 'v', 'w', 'x', 'z', 'u', 'p'])

/** Fraction of em above which a shape-ambiguous glyph is treated as a capital. */
const CAP_HEIGHT_RATIO = 0.58

/**
 * Highest point of an outline above the baseline, in font units. Font paths use
 * a y-up design space (ascenders are negative), so the ascent is the magnitude
 * of the most-negative y coordinate.
 */
export function glyphAscent(path: string): number {
  const numbers = path.match(/-?\d+\.?\d*/g)
  if (numbers === null) return 0
  let minY = 0
  for (let i = 1; i < numbers.length; i += 2) {
    const y = Number(numbers[i])
    if (y < minY) minY = y
  }
  return -minY
}

/**
 * Correct the case of an OCR-identified character using the glyph's ascent.
 * Non-ambiguous characters (and multi-character ligatures) are returned as-is.
 */
export function resolveGlyphCase(
  char: string,
  path: string,
  unitsPerEm: number
): string {
  if (char.length !== 1) return char
  const lower = char.toLowerCase()
  if (!SHAPE_AMBIGUOUS.has(lower)) return char
  if (unitsPerEm <= 0) return char

  const ratio = glyphAscent(path) / unitsPerEm
  return ratio >= CAP_HEIGHT_RATIO ? lower.toUpperCase() : lower
}
