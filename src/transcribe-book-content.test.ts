import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

import type { OcrBackend } from './ocr'
import type { BookMetadata } from './types'

import { runTranscribe } from './transcribe-book-content'

async function makeBookDir(): Promise<{
  asin: string
  outDir: string
  bookDir: string
}> {
  const asin = 'TESTASIN'
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antigraph-test-'))
  const bookDir = path.join(outDir, asin)
  await fs.mkdir(bookDir, { recursive: true })
  return { asin, outDir, bookDir }
}

async function writeMetadata(
  bookDir: string,
  pages: BookMetadata['pages'],
  toc: BookMetadata['toc'] = []
): Promise<void> {
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
    toc,
    pages,
    locationMap: { locations: [], navigationUnit: [] }
  } as unknown as BookMetadata
  await fs.writeFile(
    path.join(bookDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  )
  await fs.writeFile(path.join(bookDir, '.done'), '')
}

describe('runTranscribe', () => {
  test('escapes TOC headings before stripping duplicated page headings', async () => {
    const { asin, outDir, bookDir } = await makeBookDir()
    const firstScreenshot = path.join(bookDir, 'page-0.webp')
    const secondScreenshot = path.join(bookDir, 'page-1.webp')
    await fs.writeFile(firstScreenshot, 'first')
    await fs.writeFile(secondScreenshot, 'second')
    await writeMetadata(
      bookDir,
      [
        { index: 0, page: 0, screenshot: firstScreenshot },
        { index: 1, page: 1, screenshot: secondScreenshot }
      ],
      [{ label: 'C++ (Intro)?', positionId: 1, page: 1, depth: 0 }]
    )

    const backend: OcrBackend = {
      name: 'fake',
      transcribe({ index }) {
        return Promise.resolve(
          index === 1 ? 'C++ (Intro)?\nBody text' : 'Preface text'
        )
      }
    }

    await runTranscribe({ asin, outDir, engine: 'ollama', backend })

    const content = JSON.parse(
      await fs.readFile(path.join(bookDir, 'content.json'), 'utf8')
    ) as Array<{ text: string }>
    expect(content.map((c) => c.text)).toStrictEqual([
      'Preface text',
      'Body text'
    ])
  })

  test('refuses to write partial content by default when OCR fails', async () => {
    const { asin, outDir, bookDir } = await makeBookDir()
    const screenshot = path.join(bookDir, 'page-0.webp')
    await fs.writeFile(screenshot, 'image')
    await writeMetadata(bookDir, [{ index: 0, page: 1, screenshot }])

    const backend: OcrBackend = {
      name: 'fake',
      transcribe() {
        return Promise.reject(new Error('backend down'))
      }
    }

    await expect(
      runTranscribe({ asin, outDir, engine: 'ollama', backend })
    ).rejects.toThrow('refusing to write a partial content.json')
    await expect(
      fs.access(path.join(bookDir, 'content.json'))
    ).rejects.toThrow()
  })

  test('can explicitly write partial content when allowPartial is enabled', async () => {
    const { asin, outDir, bookDir } = await makeBookDir()
    const firstScreenshot = path.join(bookDir, 'page-0.webp')
    const secondScreenshot = path.join(bookDir, 'page-1.webp')
    await fs.writeFile(firstScreenshot, 'first')
    await fs.writeFile(secondScreenshot, 'second')
    await writeMetadata(bookDir, [
      { index: 0, page: 1, screenshot: firstScreenshot },
      { index: 1, page: 2, screenshot: secondScreenshot }
    ])

    const backend: OcrBackend = {
      name: 'fake',
      transcribe({ index }) {
        if (index === 1) return Promise.reject(new Error('backend down'))
        return Promise.resolve('ok')
      }
    }

    await runTranscribe({
      asin,
      outDir,
      engine: 'ollama',
      backend,
      allowPartial: true
    })

    const content = JSON.parse(
      await fs.readFile(path.join(bookDir, 'content.json'), 'utf8')
    ) as Array<{ index: number; text: string }>
    expect(content).toStrictEqual([
      { index: 0, page: 1, screenshot: firstScreenshot, text: 'ok' }
    ])
  })
})
