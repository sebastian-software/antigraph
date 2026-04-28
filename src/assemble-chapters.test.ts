import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

import type { BookMetadata, ContentChunk } from './types'

import { runAssemble } from './assemble-chapters'

describe('runAssemble', () => {
  test('warns but still writes chapters when render page data is missing', async () => {
    const asin = 'TESTASIN'
    const outDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'antigraph-assemble-')
    )
    const bookDir = path.join(outDir, asin)
    await fs.mkdir(bookDir, { recursive: true })

    const metadata = {
      meta: { title: 'Test Book', authorList: ['Tester'] },
      info: {},
      nav: {
        startPosition: 1,
        endPosition: 100,
        startContentPosition: 1,
        startContentPage: 1,
        endContentPosition: 100,
        endContentPage: 2,
        totalNumPages: 2,
        totalNumContentPages: 2
      },
      toc: [
        { label: 'Chapter 1', positionId: 1, page: 1, depth: 0 },
        { label: 'Chapter 2', positionId: 50, page: 2, depth: 0 }
      ],
      pages: [],
      locationMap: { locations: [], navigationUnit: [] }
    } as unknown as BookMetadata
    const content: ContentChunk[] = [
      { index: 0, page: 1, screenshot: 'page-1.webp', text: 'First page.' },
      { index: 1, page: 2, screenshot: 'page-2.webp', text: 'Second page.' }
    ]

    await fs.writeFile(
      path.join(bookDir, 'metadata.json'),
      JSON.stringify(metadata)
    )
    await fs.writeFile(
      path.join(bookDir, 'content.json'),
      JSON.stringify(content)
    )

    await runAssemble({ asin, outDir })

    const chapters = JSON.parse(
      await fs.readFile(path.join(bookDir, 'chapters.json'), 'utf8')
    ) as Array<{ title: string; slug: string }>
    expect(chapters).toHaveLength(2)
    expect(chapters.map((c) => c.slug)).toStrictEqual([
      'chapter-1',
      'chapter-2'
    ])
  })
})
