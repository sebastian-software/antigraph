import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, test } from 'vitest'

import type { BookMetadata, Chapter } from './types'
import { runExport } from './export-book-markdown'

describe('runExport', () => {
  test('writes book.md and skips empty per-chapter files', async () => {
    const asin = 'TESTASIN'
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antigraph-export-'))
    const bookDir = path.join(outDir, asin)
    await fs.mkdir(bookDir, { recursive: true })

    const metadata = {
      meta: { title: 'Test Book', authorList: ['Ada Lovelace'] }
    } as BookMetadata
    const chapters: Chapter[] = [
      {
        index: 0,
        depth: 0,
        title: 'Part I',
        slug: 'part-i',
        startPositionId: 1,
        startPage: -1,
        endPage: -1,
        contentIndices: [],
        text: ''
      },
      {
        index: 1,
        depth: 1,
        title: '1. First Chapter',
        slug: '1-first-chapter',
        startPositionId: 10,
        startPage: 1,
        endPage: 2,
        contentIndices: [0, 1],
        text: 'Hello world.'
      }
    ]

    await fs.writeFile(
      path.join(bookDir, 'metadata.json'),
      JSON.stringify(metadata)
    )
    await fs.writeFile(
      path.join(bookDir, 'chapters.cleaned.json'),
      JSON.stringify(chapters)
    )

    await runExport({ asin, outDir })

    const book = await fs.readFile(path.join(bookDir, 'book.md'), 'utf8')
    expect(book).toContain('# Test Book')
    expect(book).toContain('- [Part I](chapters/000-part-i.md)')
    expect(book).toContain('### 1. First Chapter')

    const files = await fs.readdir(path.join(bookDir, 'chapters'))
    expect(files).toEqual(['001-1-first-chapter.md'])
  })
})
