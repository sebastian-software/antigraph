import sharp from 'sharp'

import type { OcrBackend } from '../ocr'

import { glyphPathXExtent } from './rasterize'

/**
 * Label the self-calibrated glyph clusters in one shot.
 *
 * Each cluster is a clean, denoised template. We arrange one representative
 * glyph per cluster into a numbered grid image and ask the vision model to
 * return every character at once — a single call per book font instead of one
 * per glyph, and the model sees the whole alphabet together, which helps it
 * tell size- and stroke-similar letters apart.
 */

export const LABEL_GRID_PROMPT =
  'This image is a numbered grid of single glyphs from one book font, black on ' +
  'white. Identify the character in every numbered cell. Respond with ONLY a ' +
  'JSON object mapping each cell number to its character, e.g. ' +
  '{"0":"a","1":"T","2":"fi","3":","}. Preserve upper/lower case; use the exact ' +
  'digit for digits, the exact punctuation mark, and the ligature (e.g. "fi", ' +
  '"ffi") where present. No prose, no code fences.'

const CELL = 96
const COLUMNS = 12
const GLYPH_FRACTION = 0.62
const BASELINE_FRACTION = 0.68
const LABEL_HEIGHT = 16

export type LabelCell = {
  path: string
  unitsPerEm: number
}

function cellSvg(
  cell: LabelCell,
  at: { x: number; y: number; index: number }
): string {
  const { x, y, index } = at
  const em = cell.unitsPerEm > 0 ? cell.unitsPerEm : 1000
  const scale = (CELL * GLYPH_FRACTION) / em
  const baseline = y + CELL * BASELINE_FRACTION
  const { minX, maxX } = glyphPathXExtent(cell.path)
  const width = (maxX - minX) * scale
  const gx = x + (CELL - width) / 2 - minX * scale
  return (
    `<rect x="${x}" y="${y}" width="${CELL - 2}" height="${CELL - 2}" fill="#fff" stroke="#e5e5e5"/>` +
    `<g transform="translate(${gx.toFixed(2)} ${baseline.toFixed(2)}) scale(${scale.toFixed(5)} ${scale.toFixed(5)})">` +
    `<path d="${cell.path}" fill="#000" fill-rule="evenodd"/></g>` +
    `<text x="${x + 4}" y="${y + CELL - 5}" font-family="monospace" font-size="11" fill="#0a7">${index}</text>`
  )
}

/** Render the numbered cluster grid to a PNG buffer. Pure apart from sharp. */
export async function renderLabelGrid(cells: LabelCell[]): Promise<Buffer> {
  const rows = Math.max(1, Math.ceil(cells.length / COLUMNS))
  const width = COLUMNS * CELL
  const height = rows * CELL + LABEL_HEIGHT
  const parts = cells.map((cell, index) => {
    const col = index % COLUMNS
    const row = Math.floor(index / COLUMNS)
    return cellSvg(cell, { x: col * CELL, y: row * CELL, index })
  })
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect width="${width}" height="${height}" fill="#fafafa"/>${parts.join('')}</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/**
 * Parse the model's JSON reply into `cellIndex → character`. Tolerant of code
 * fences and surrounding prose: it extracts the first `{…}` block.
 */
export function parseGridLabels(response: string): Map<number, string> {
  const labels = new Map<number, string>()
  const start = response.indexOf('{')
  const end = response.lastIndexOf('}')
  if (start === -1 || end <= start) return labels

  let parsed: unknown
  try {
    parsed = JSON.parse(response.slice(start, end + 1))
  } catch {
    return labels
  }
  if (typeof parsed !== 'object' || parsed === null) return labels

  for (const [key, value] of Object.entries(parsed)) {
    const index = Number(key)
    if (
      Number.isInteger(index) &&
      typeof value === 'string' &&
      value.length > 0
    ) {
      labels.set(index, value)
    }
  }
  return labels
}

/** Render the grid, ask the backend once, and return `cellIndex → character`. */
export async function labelCells(
  cells: LabelCell[],
  backend: OcrBackend
): Promise<Map<number, string>> {
  if (cells.length === 0) return new Map()
  const imageBuffer = await renderLabelGrid(cells)
  const response = await backend.transcribe({
    imageBuffer,
    mimeType: 'image/png',
    index: 0,
    screenshot: 'glyph-label-grid',
    format: 'plain'
  })
  return parseGridLabels(response)
}
