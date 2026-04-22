/**
 * Deterministic transforms on chapter text, extracted as pure functions so
 * they can be unit-tested independently of the file-reading script in
 * `cleanup-chapters.ts`. Guiding rule: never rewrite sentences, never
 * touch diction, punctuation, or typography beyond whitespace
 * normalization. The LLM review stage runs after this and must trust the
 * text as authored.
 */

const escapeRegExp = (s: string) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Strip the chapter heading from the start of the text when the model
 * included it in the transcription. Matches the TOC-provided title in
 * two forms:
 *
 *   - single-line: "The Audience\n…"
 *   - split-on-colon: "Writing About People\nThe Interview\n…"
 *     (TOC labels like "12. Writing About People: The Interview" render
 *     with the colon becoming a line break in the book)
 *
 * Leading numeric prefixes in the TOC title ("12. ") are stripped before
 * matching — they never appear on the page. Returns input unchanged when
 * the heading isn't found (many chapters OCR with no visible header).
 */
export function stripChapterHeading(text: string, title: string): string {
  const stripped = title.replace(/^\s*\d+\.\s*/, '').trim()
  if (!stripped) return text

  const parts = stripped
    .split(/\s*:\s*/)
    .map((p) => p.trim())
    .filter(Boolean)

  const candidates = parts.length > 1 ? [parts, [stripped]] : [[stripped]]

  for (const candidate of candidates) {
    if (candidate.length === 0) continue
    const pattern = new RegExp(
      '^\\s*' +
        candidate.map(escapeRegExp).join('\\s*\\n\\s*') +
        '\\s*(?:\\n+|$)',
      'u'
    )
    if (pattern.test(text)) return text.replace(pattern, '')
  }
  return text
}

/**
 * Normalize whitespace: normalize line endings, strip trailing whitespace
 * per line, collapse runs of 3+ newlines into a single paragraph break,
 * trim leading/trailing blank lines. Does not touch intra-line spacing —
 * preserves intentional double spaces, non-breaking spaces, etc.
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replaceAll(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/u, ''))
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Merge paragraphs that are split mid-sentence by a page break.
 *
 * Symptom: the previous paragraph ends with a letter or continuation
 * punctuation (`,` or `;`) — i.e. not a sentence-final punctuation —
 * and the next paragraph starts with a lowercase letter. That almost
 * always means OCR captured a paragraph cut by the page edge. We
 * rejoin with a single space.
 *
 * Conservative by design: only triggers on (letter|`,;`) + lowercase.
 * A paragraph that legitimately starts lowercase (extremely rare in
 * prose) would get merged incorrectly only if the previous paragraph
 * also ended without terminal punctuation — an unusual combination.
 */
export function mergeSplitParagraphs(text: string): string {
  const paragraphs = text.split(/\n{2,}/)
  const out: string[] = []
  for (const raw of paragraphs) {
    const para = raw.trim()
    if (!para) continue
    const prev = out.at(-1)
    if (prev) {
      const prevLast = prev.at(-1) ?? ''
      const nextFirst = para.charAt(0)
      const prevEndsOpen =
        /[\p{L},;]/u.test(prevLast) && !/[.!?]/u.test(prevLast)
      const nextStartsLower = /^\p{Ll}/u.test(nextFirst)
      if (prevEndsOpen && nextStartsLower) {
        out[out.length - 1] = prev + ' ' + para
        continue
      }
    }
    out.push(para)
  }
  return out.join('\n\n')
}

/**
 * Apply the full cleanup pipeline to a chapter's text. Order matters:
 *
 *   1. Strip the duplicated heading first — before whitespace
 *      normalization, because the heading is detected by newline shape.
 *   2. Normalize whitespace next — collapsing blank runs shapes what
 *      `mergeSplitParagraphs` sees as paragraph boundaries.
 *   3. Merge split paragraphs — operates on `\n\n`-separated paragraphs.
 */
export function cleanChapterText(text: string, title: string): string {
  let t = stripChapterHeading(text, title)
  t = normalizeWhitespace(t)
  t = mergeSplitParagraphs(t)
  return t
}
