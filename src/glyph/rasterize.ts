import sharp from 'sharp'

/**
 * Rasterize a glyph outline for shape matching. Reference glyphs (from the
 * clean font) and book glyphs (from `glyphs.json`) both go through this exact
 * function so the same letter produces the same image.
 *
 * Two properties are load-bearing, learned the hard way:
 * - **No vertical flip.** Both the font's outlines (via opentype) and Amazon's
 *   render paths use a y-up design space; a `scale(_, -1)` mirrors them and
 *   makes b/d, o/b, n/u indistinguishable.
 * - **Size-preserving, not bbox-fit.** A fixed em scale and baseline keep a
 *   lower-case `s` smaller than a capital `S`; normalizing each glyph to fill
 *   the cell would erase the only thing that separates same-shape case pairs.
 *
 * `fill-rule="evenodd"` keeps counters (the holes in o, b, e, …) open
 * regardless of contour winding.
 */

export const RASTER_SIZE = 64
const EM_SCALE_FRACTION = 0.6
const BASELINE_FRACTION = 0.72

/** Horizontal extent of a path's coordinates, treating them as x,y pairs. */
export function glyphPathXExtent(path: string): { minX: number; maxX: number } {
  const numbers = path.match(/-?\d+\.?\d*/g)
  if (numbers === null) return { minX: 0, maxX: 0 }
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  for (let i = 0; i < numbers.length; i += 2) {
    const x = Number(numbers[i])
    if (x < minX) minX = x
    if (x > maxX) maxX = x
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return { minX: 0, maxX: 0 }
  }
  return { minX, maxX }
}

/** Build the matching SVG for one glyph outline. Pure, so it can be tested. */
export function glyphMatchSvg(path: string, unitsPerEm: number): string {
  const em = unitsPerEm > 0 ? unitsPerEm : 1000
  const scale = (RASTER_SIZE * EM_SCALE_FRACTION) / em
  const baseline = RASTER_SIZE * BASELINE_FRACTION
  const { minX, maxX } = glyphPathXExtent(path)
  const width = (maxX - minX) * scale
  const x = (RASTER_SIZE - width) / 2 - minX * scale
  const transform = `translate(${x.toFixed(3)} ${baseline.toFixed(3)}) scale(${scale.toFixed(5)} ${scale.toFixed(5)})`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${RASTER_SIZE}" height="${RASTER_SIZE}">` +
    `<rect width="${RASTER_SIZE}" height="${RASTER_SIZE}" fill="#fff"/>` +
    `<g transform="${transform}"><path d="${path}" fill="#000" fill-rule="evenodd"/></g></svg>`
  )
}

/** Rasterize one glyph outline to a greyscale byte array (0=black, 255=white). */
export async function rasterizeGlyph(
  path: string,
  unitsPerEm: number
): Promise<Uint8Array> {
  const buffer = await sharp(Buffer.from(glyphMatchSvg(path, unitsPerEm)))
    .greyscale()
    .raw()
    .toBuffer()
  return new Uint8Array(buffer)
}
