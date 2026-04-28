import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

import type { BookMetadata, Chapter, ContentChunk } from './types'

import { runAssemble } from './assemble-chapters'

const baseMeta = {
  ACR: '',
  asin: 'TESTASIN',
  authorList: ['Tester'],
  bookSize: '',
  bookType: '',
  cover: '',
  language: 'en',
  positions: { cover: 0, srl: 0, toc: 0 },
  publisher: '',
  refEmId: '',
  releaseDate: '',
  sample: false,
  title: 'Test Book',
  version: '',
  startPosition: 1,
  endPosition: 100
}

const baseInfo = {
  clippingLimit: 0,
  contentChecksum: null,
  contentType: '',
  contentVersion: '',
  deliveredAsin: 'TESTASIN',
  downloadRestrictionReason: null,
  expirationDate: null,
  format: '',
  formatVersion: '',
  fragmentMapUrl: null,
  hasAnnotations: false,
  isOwned: true,
  isSample: false,
  kindleSessionId: '',
  lastPageReadData: { deviceName: '', position: 0, syncTime: 0 },
  manifestUrl: null,
  originType: '',
  pageNumberUrl: null,
  requestedAsin: 'TESTASIN',
  srl: 0
}

async function writeBookFixture(
  bookDir: string,
  metadata: BookMetadata,
  content: ContentChunk[]
): Promise<void> {
  await fs.mkdir(bookDir, { recursive: true })
  await fs.writeFile(
    path.join(bookDir, 'metadata.json'),
    JSON.stringify(metadata)
  )
  await fs.writeFile(
    path.join(bookDir, 'content.json'),
    JSON.stringify(content)
  )
}

async function readChapters(bookDir: string): Promise<Chapter[]> {
  return JSON.parse(
    await fs.readFile(path.join(bookDir, 'chapters.json'), 'utf8')
  ) as Chapter[]
}

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

    await writeBookFixture(bookDir, metadata, content)

    await runAssemble({ asin, outDir })

    const chapters = await readChapters(bookDir)
    expect(chapters).toHaveLength(2)
    expect(chapters.map((c) => c.slug)).toStrictEqual([
      'chapter-1',
      'chapter-2'
    ])
  })

  test('uses render page positions to assemble chapter boundaries', async () => {
    const asin = 'TESTASIN'
    const outDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'antigraph-assemble-')
    )
    const bookDir = path.join(outDir, asin)
    const renderDir = path.join(bookDir, 'render', 'batch-1')
    const metadata: BookMetadata = {
      meta: baseMeta,
      info: baseInfo,
      nav: {
        startPosition: 1,
        endPosition: 120,
        startContentPosition: 1,
        startContentPage: 1,
        endContentPosition: 120,
        endContentPage: 3,
        totalNumPages: 3,
        totalNumContentPages: 3
      },
      toc: [
        { label: 'Intro?', positionId: 10, page: 1, depth: 0 },
        { label: 'Part I', positionId: 30, page: 2, depth: 0 },
        { label: 'Chapter 1', positionId: 40, page: 2, depth: 1 },
        { label: 'Notes', positionId: 50, location: 5, depth: 1 },
        { label: 'Appendix', positionId: 200, page: 3, depth: 0 }
      ],
      pages: [],
      locationMap: {
        locations: [],
        navigationUnit: [
          { startPosition: 10, page: 1, label: '1' },
          { startPosition: 30, page: 2, label: '2' },
          { startPosition: 40, page: 2, label: '2' },
          { startPosition: 90, page: 3, label: '3' }
        ]
      }
    }
    const content: ContentChunk[] = [
      { index: 0, page: 1, screenshot: 'page-1.webp', text: 'Intro text.' },
      { index: 1, page: 2, screenshot: 'page-2a.webp', text: 'Part text.' },
      { index: 2, page: 2, screenshot: 'page-2b.webp', text: 'Chapter-' },
      { index: 3, page: 3, screenshot: 'page-3.webp', text: 'text.' }
    ]

    await writeBookFixture(bookDir, metadata, content)
    await fs.mkdir(renderDir, { recursive: true })
    await fs.writeFile(path.join(bookDir, 'render', 'not-a-dir'), '')
    await fs.writeFile(path.join(renderDir, 'ignored.json'), '[]')
    await fs.writeFile(path.join(renderDir, 'page_data_0_0.json'), '{}')
    await fs.writeFile(
      path.join(renderDir, 'page_data_0_1.json'),
      JSON.stringify([
        { startPositionId: 10, endPositionId: 19 },
        { startPositionId: 'bad', endPositionId: 29 },
        { startPositionId: 30, endPositionId: 39 },
        { startPositionId: 40, endPositionId: 49 },
        { startPositionId: 90, endPositionId: 99 }
      ])
    )

    await runAssemble({ asin, outDir })

    const chapters = await readChapters(bookDir)
    expect(chapters.map((chapter) => chapter.slug)).toStrictEqual([
      'intro',
      'part-i',
      'chapter-1'
    ])
    expect(chapters.map((chapter) => chapter.contentIndices)).toStrictEqual([
      [0],
      [1],
      [2, 3]
    ])
    expect(chapters.at(-1)?.text).toBe('Chaptertext\n\n.')
  })
})
