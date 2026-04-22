import fs from 'node:fs/promises'
import path from 'node:path'

import type { BookMetadata, Chapter } from './types'
import { assert, fileExists, readJsonFile, tryReadJsonFile } from './utils'

export interface ExportOptions {
  asin: string
  outDir: string
}

/**
 * Stage 3 of the chapter pipeline: markdown export.
 *
 * Consumes the cleaned chapters (`chapters.cleaned.json`, falling back
 * to `chapters.json` if cleanup hasn't run yet) and emits:
 *
 *   - `<outDir>/<asin>/chapters/<NN-slug>.md` — one self-contained file
 *     per chapter, usable as input for EPUB builders, translation tools,
 *     or diffable review.
 *   - `<outDir>/<asin>/book.md` — single concatenated file with front-
 *     matter, TOC, and every chapter.
 *
 * Heading depth: book title is H1, depth-0 TOC items (Parts, front- and
 * back-matter) are H2, depth-1 chapters are H3.
 */

function chapterFilename(c: Chapter): string {
  // Zero-pad the index so readers/file pickers keep chapters in reading
  // order without a custom sort.
  const n = String(c.index).padStart(3, '0')
  return `${n}-${c.slug}.md`
}

function renderTocLine(c: Chapter, pageDir: string): string {
  const indent = '  '.repeat(Math.max(c.depth, 0))
  const href = `${pageDir}/${chapterFilename(c)}`
  return `${indent}- [${c.title}](${href})`
}

/**
 * Render a chapter as a markdown block with its title as a heading.
 * `headingLevel` is 1-6 (H1-H6); clamped to that range.
 *
 * Per-chapter files use level 1 (self-contained). In book.md, depth-0
 * items (Parts / front-/back-matter) are H2 and depth-1 chapters H3,
 * keeping the book title as the sole H1.
 */
function renderChapter(c: Chapter, headingLevel: number): string {
  const hashes = '#'.repeat(Math.min(Math.max(headingLevel, 1), 6))
  const body = c.text.trim()
  if (!body) return `${hashes} ${c.title}\n`
  return `${hashes} ${c.title}\n\n${body}\n`
}

export async function runExport(options: ExportOptions): Promise<void> {
  const bookDir = path.join(options.outDir, options.asin)
  const cleanedPath = path.join(bookDir, 'chapters.cleaned.json')
  const rawPath = path.join(bookDir, 'chapters.json')

  const chapters =
    (await tryReadJsonFile<Chapter[]>(cleanedPath)) ??
    (await tryReadJsonFile<Chapter[]>(rawPath))
  assert(
    chapters?.length,
    `no chapters found — run the assemble stage first (looked at ${cleanedPath} and ${rawPath})`
  )
  const source = (await fileExists(cleanedPath)) ? cleanedPath : rawPath

  const metadata = await readJsonFile<BookMetadata>(
    path.join(bookDir, 'metadata.json')
  )
  const title = metadata.meta.title
  const authors = metadata.meta.authorList

  const chaptersDir = path.join(bookDir, 'chapters')
  await fs.mkdir(chaptersDir, { recursive: true })

  // Per-chapter files. Skip empty chapters (parts with no body) — their
  // heading is still in book.md's TOC + the concatenated view.
  let perChapterWritten = 0
  for (const c of chapters) {
    if (!c.text.trim()) continue
    const filePath = path.join(chaptersDir, chapterFilename(c))
    await fs.writeFile(filePath, renderChapter(c, 1))
    perChapterWritten++
  }

  // book.md = front matter + TOC + all chapters concatenated.
  const tocLines = chapters.map((c) => renderTocLine(c, 'chapters'))
  const bookBody = chapters.map((c) => renderChapter(c, c.depth + 2)).join('\n')
  const book = [
    `# ${title}`,
    '',
    `> By ${authors.join(', ')}`,
    '',
    '---',
    '',
    '## Table of Contents',
    '',
    ...tocLines,
    '',
    '---',
    '',
    bookBody
  ].join('\n')
  const bookPath = path.join(bookDir, 'book.md')
  await fs.writeFile(bookPath, book)

  const totalChars = chapters.reduce((s, c) => s + c.text.length, 0)
  console.log(
    `wrote ${perChapterWritten} chapter files to ${chaptersDir}/ + book.md (${totalChars} chars, from ${path.basename(source)})`
  )
}
