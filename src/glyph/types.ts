/**
 * Data model for the non-OCR glyph-reconstruction transcriber.
 *
 * The Kindle Cloud Reader render TAR (already extracted to
 * `out/<asin>/render/<hash>/` by the extract stage) carries the full text of a
 * book as positioned vector glyphs plus a structural layout tree, but never as
 * Unicode. These types capture the three inputs we need to turn that back into
 * text:
 *
 * - {@link GlyphFont}: `glyphs.json` — glyphId → outline, per font, per chunk;
 * - {@link GlyphRun}: `page_data_*.json` — the ordered glyph stream with a
 *   base positionId and per-run font/style;
 * - {@link LayoutPage}: `layout.json` — the page → paragraph → word skeleton,
 *   with each word carrying an inclusive positionId range.
 *
 * Amazon re-randomizes glyphIds *and* outline coordinates per render chunk, so
 * a {@link GlyphMap} is only valid within the chunk it was identified from.
 */

/** A single font subset delivered in one render chunk's `glyphs.json`. */
export type GlyphFont = {
  fontKey: string
  unitsPerEm: number
  /** glyphId → SVG outline path. Only `type:"path"` glyphs are retained. */
  glyphs: Map<number, string>
}

/** One `type:"run"` text element from `page_data_*.json`. */
export type GlyphRun = {
  fontKey: string
  /** positionId of the first glyph; glyph `i` sits at `startPositionId + i`. */
  startPositionId: number
  glyphIds: number[]
  italic: boolean
  bold: boolean
}

/** A word node from `layout.json`, as an inclusive positionId range. */
export type LayoutWord = {
  startPositionId: number
  endPositionId: number
}

export type LayoutParagraph = {
  /** 1–6 when the paragraph is a heading, otherwise `undefined`. */
  headingLevel: number | undefined
  words: LayoutWord[]
}

export type LayoutPage = {
  startPositionId: number
  endPositionId: number
  paragraphs: LayoutParagraph[]
}

/** Everything parsed from one render chunk directory. */
export type ChunkModel = {
  fonts: Map<string, GlyphFont>
  runs: GlyphRun[]
  pages: LayoutPage[]
}

/**
 * Identification result: `fontKey` → (`glyphId` → character(s)). Ligatures map
 * to multi-character strings (e.g. `"fi"`). Valid only for the chunk it came
 * from.
 */
export type GlyphMap = Map<string, Map<number, string>>

/** A resolved character together with the emphasis of the run it came from. */
export type StyledChar = {
  char: string
  italic: boolean
  bold: boolean
}
