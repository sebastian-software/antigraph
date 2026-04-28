import fs from 'node:fs/promises'
import path from 'node:path'

import type { Chapter } from './types'

import { cleanChapterText } from './chapter-cleanup'
import { readJsonFile } from './utils'

export interface CleanupOptions {
  asin: string
  outDir: string
}

/**
 * Stage 1 of the chapter pipeline: deterministic cleanup.
 *
 * Input: `chapters.json` (raw assembly output from `assemble-chapters.ts`).
 * Output: `chapters.cleaned.json` (same structure, with `text` normalized).
 *
 * All transforms live in `chapter-cleanup.ts` as pure functions so they
 * stay unit-testable without touching disk. This file just orchestrates
 * read → map → write.
 */
export async function runCleanup(options: CleanupOptions): Promise<void> {
  const bookDir = path.join(options.outDir, options.asin)
  const chapters = await readJsonFile<Chapter[]>(
    path.join(bookDir, 'chapters.json')
  )

  const cleaned: Chapter[] = chapters.map((c) => ({
    ...c,
    text: cleanChapterText(c.text, c.title)
  }))

  const outPath = path.join(bookDir, 'chapters.cleaned.json')
  await fs.writeFile(outPath, JSON.stringify(cleaned, null, 2))

  const totalCharsBefore = chapters.reduce((s, c) => s + c.text.length, 0)
  const totalCharsAfter = cleaned.reduce((s, c) => s + c.text.length, 0)
  const delta = totalCharsAfter - totalCharsBefore
  console.log(
    `wrote ${cleaned.length} cleaned chapters to ${outPath} (${delta >= 0 ? '+' : ''}${delta} chars, ${totalCharsAfter} total)`
  )
  for (const c of cleaned) {
    const before = chapters[c.index]?.text.length ?? 0
    const after = c.text.length
    const d = after - before
    const marker = c.depth === 0 ? ' · ' : '   ↳ '
    console.log(
      `${marker}${c.title.padEnd(50)}  ${before}c → ${after}c  (${d >= 0 ? '+' : ''}${d})`
    )
  }
}
