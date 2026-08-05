import type {
  GlyphMap,
  GlyphRun,
  LayoutPage,
  LayoutParagraph,
  StyledChar
} from './types'

/**
 * The validated core: turn a positionId → character map plus the layout
 * skeleton back into Markdown. Deterministic and I/O-free — the whole
 * correctness of the non-OCR path rests here, so it is unit-tested directly.
 */

/** Placeholder for a glyph the identification step could not resolve. */
const REPLACEMENT = '�'
const MAX_HEADING_LEVEL = 6

/**
 * Map every positionId to its resolved character and emphasis. Glyph `i` of a
 * run sits at `startPositionId + i`; ligatures advance the positionId by their
 * character length so multi-character glyphs stay aligned with the layout's
 * positionId ranges.
 */
export function buildPositionChars(
  runs: GlyphRun[],
  glyphMap: GlyphMap
): Map<number, StyledChar> {
  const positionChars = new Map<number, StyledChar>()

  for (const run of runs) {
    const fontMap = glyphMap.get(run.fontKey)
    let positionId = run.startPositionId
    for (const glyphId of run.glyphIds) {
      const char = fontMap?.get(glyphId) ?? REPLACEMENT
      positionChars.set(positionId, {
        char,
        italic: run.italic,
        bold: run.bold
      })
      positionId += Math.max(char.length, 1)
    }
  }

  return positionChars
}

type Word = {
  text: string
  italic: boolean
  bold: boolean
}

function readWord(
  startPositionId: number,
  endPositionId: number,
  positionChars: Map<number, StyledChar>
): undefined | Word {
  let text = ''
  let italic = false
  let bold = false
  let seen = false
  for (let pid = startPositionId; pid <= endPositionId; pid++) {
    const styled = positionChars.get(pid)
    if (styled === undefined) continue
    if (!seen) {
      italic = styled.italic
      bold = styled.bold
      seen = true
    }
    text += styled.char
  }
  return seen && text.length > 0 ? { text, italic, bold } : undefined
}

function emphasisMarker(italic: boolean, bold: boolean): string {
  if (italic && bold) return '***'
  if (bold) return '**'
  if (italic) return '*'
  return ''
}

/** Join words into a paragraph, wrapping maximal same-emphasis spans once. */
function joinWords(words: Word[]): string {
  const parts: string[] = []
  let group: Word[] = []

  const flush = () => {
    const first = group[0]
    if (first === undefined) return
    const marker = emphasisMarker(first.italic, first.bold)
    parts.push(marker + group.map((word) => word.text).join(' ') + marker)
    group = []
  }

  for (const word of words) {
    const head = group[0]
    if (
      head !== undefined &&
      (head.italic !== word.italic || head.bold !== word.bold)
    ) {
      flush()
    }
    group.push(word)
  }
  flush()

  return parts.join(' ')
}

function reconstructParagraph(
  paragraph: LayoutParagraph,
  positionChars: Map<number, StyledChar>
): string {
  const words: Word[] = []
  for (const word of paragraph.words) {
    const read = readWord(
      word.startPositionId,
      word.endPositionId,
      positionChars
    )
    if (read) words.push(read)
  }
  if (words.length === 0) return ''

  const text = joinWords(words)
  const level = paragraph.headingLevel
  if (level !== undefined && level >= 1 && level <= MAX_HEADING_LEVEL) {
    return `${'#'.repeat(level)} ${text}`
  }
  return text
}

/** Reconstruct one page's Markdown from the layout skeleton and character map. */
export function reconstructPageText(
  page: LayoutPage,
  positionChars: Map<number, StyledChar>
): string {
  const paragraphs: string[] = []
  for (const paragraph of page.paragraphs) {
    const text = reconstructParagraph(paragraph, positionChars)
    if (text.length > 0) paragraphs.push(text)
  }
  return paragraphs.join('\n\n')
}
