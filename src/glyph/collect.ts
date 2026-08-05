import type {
  GlyphFont,
  GlyphRun,
  LayoutPage,
  LayoutParagraph,
  LayoutWord
} from './types'

/**
 * Pure parsers turning the raw JSON of one render chunk into the typed model in
 * {@link ./types}. Kept free of I/O so they can be unit-tested against small
 * fixtures; the orchestrator in `../transcribe-glyphs.ts` reads the files.
 */

const BOLD_WEIGHT_THRESHOLD = 600

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Depth-first walk over the loose page_data / layout node trees. */
function walk(node: unknown, visit: (record: Record<string, unknown>) => void) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!isRecord(node)) return
  visit(node)
  for (const key of Object.keys(node)) {
    const value = node[key]
    if (Array.isArray(value) || isRecord(value)) walk(value, visit)
  }
}

function parseGlyphOutlines(glyphsRaw: unknown): Map<number, string> {
  const glyphs = new Map<number, string>()
  if (!isRecord(glyphsRaw)) return glyphs
  for (const [id, value] of Object.entries(glyphsRaw)) {
    const path = isRecord(value) ? asString(value.path) : undefined
    const glyphId = Number(id)
    if (path !== undefined && Number.isInteger(glyphId)) {
      glyphs.set(glyphId, path)
    }
  }
  return glyphs
}

/** Parse `glyphs.json` into fonts keyed by fontKey; keeps only path outlines. */
export function parseFonts(glyphsJson: unknown): Map<string, GlyphFont> {
  const fonts = new Map<string, GlyphFont>()
  const list = Array.isArray(glyphsJson) ? glyphsJson : [glyphsJson]

  for (const raw of list) {
    if (!isRecord(raw)) continue
    const fontKey = asString(raw.fontKey) ?? asString(raw.fontFamily)
    if (fontKey === undefined) continue
    fonts.set(fontKey, {
      fontKey,
      unitsPerEm: asNumber(raw.unitsPerEm) ?? 1000,
      glyphs: parseGlyphOutlines(raw.glyphs)
    })
  }

  return fonts
}

/** Collect the ordered glyph runs from a `page_data_*.json` tree. */
export function collectRuns(pageData: unknown): GlyphRun[] {
  const runs: GlyphRun[] = []

  walk(pageData, (record) => {
    if (record.type !== 'run') return
    const glyphsValue = record.glyphs
    const fontKey = asString(record.fontKey)
    const startPositionId = asNumber(record.startPositionId)
    if (!Array.isArray(glyphsValue) || fontKey === undefined) return
    if (startPositionId === undefined) return

    const glyphIds = glyphsValue.filter(
      (value): value is number => typeof value === 'number'
    )
    const weight = asNumber(record.fontWeight) ?? 400

    runs.push({
      fontKey,
      startPositionId,
      glyphIds,
      italic: asString(record.fontStyle) === 'italic',
      bold: weight >= BOLD_WEIGHT_THRESHOLD
    })
  })

  return runs
}

function collectWords(paragraphNode: Record<string, unknown>): LayoutWord[] {
  const words: LayoutWord[] = []
  walk(paragraphNode.children, (record) => {
    if (record.type !== 'word') return
    const startPositionId = asNumber(record.startPositionId)
    const endPositionId = asNumber(record.endPositionId)
    if (startPositionId === undefined || endPositionId === undefined) return
    words.push({ startPositionId, endPositionId })
  })
  return words
}

/** Collect pages (each with its paragraphs and words) from `layout.json`. */
export function collectLayoutPages(layout: unknown): LayoutPage[] {
  const pages: LayoutPage[] = []

  walk(layout, (record) => {
    if (record.type !== 'page') return
    const startPositionId = asNumber(record.startPositionId)
    const endPositionId = asNumber(record.endPositionId)
    if (startPositionId === undefined || endPositionId === undefined) return

    const paragraphs: LayoutParagraph[] = []
    walk(record.children, (inner) => {
      if (inner.type !== 'paragraph') return
      paragraphs.push({
        headingLevel: asNumber(inner.headingLevel),
        words: collectWords(inner)
      })
    })

    pages.push({ startPositionId, endPositionId, paragraphs })
  })

  return pages
}
