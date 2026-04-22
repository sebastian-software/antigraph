import fs from 'node:fs/promises'
import path from 'node:path'

import delay from 'delay'

import type { BookMetadata, ContentChunk, PageChunk, TocItem } from './types'
import {
  createOcrBackend,
  type OcrBackend,
  type OcrBackendOptions,
  type OcrEngine,
  type OcrFormat
} from './ocr'
import {
  assert,
  dehyphenateAcrossPages,
  escapeRegExp,
  fileExists,
  tryReadJsonFile
} from './utils'

const TRANSCRIBE_CONCURRENCY = 16
const POLL_INTERVAL_MS = 500
const STARTUP_TIMEOUT_MS = 10 * 60 * 1000

export interface TranscribeOptions {
  asin: string
  outDir: string
  engine: OcrEngine
  backendOptions?: OcrBackendOptions
  backend?: OcrBackend
  format?: OcrFormat
  maxPages?: number
  allowPartial?: boolean
}

async function transcribePage(
  backend: OcrBackend,
  pageChunk: PageChunk,
  prevPage: PageChunk | undefined,
  pageToTocItemMap: Record<number, TocItem>,
  format: OcrFormat
): Promise<ContentChunk | undefined> {
  const { screenshot, index, page } = pageChunk

  // Extract may have registered the page in metadata just before the file
  // lands on disk; wait a little in that case rather than bailing out.
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await fileExists(screenshot)) break
    await delay(POLL_INTERVAL_MS)
  }

  const imageBuffer = await fs.readFile(screenshot)

  let text = await backend.transcribe({
    imageBuffer,
    mimeType: 'image/webp',
    index,
    screenshot,
    format
  })

  // When a TOC heading sits at the top of this page and the previous page
  // ended with different content, the model often includes the heading in
  // its output — strip it so the downstream markdown/PDF aren't
  // duplicated.
  if (prevPage && prevPage.page !== page) {
    const tocItem = pageToTocItemMap[page]
    if (tocItem) {
      text = text.replace(
        // eslint-disable-next-line security/detect-non-literal-regexp
        new RegExp(`^${escapeRegExp(tocItem.label)}\\s*`, 'i'),
        ''
      )
    }
  }

  const result: ContentChunk = { index, page, text, screenshot }
  console.log(result)
  return result
}

export async function runTranscribe(options: TranscribeOptions): Promise<void> {
  const { asin, outDir, engine, maxPages } = options
  const format = options.format ?? 'plain'
  const allowPartial = options.allowPartial ?? false
  const bookDir = path.join(outDir, asin)
  const metadataPath = path.join(bookDir, 'metadata.json')
  const donePath = path.join(bookDir, '.done')

  // Wait for extract to have written at least an initial metadata.json
  // (covers the concurrent-startup race when extract + transcribe run in
  // parallel via the CLI's `--all` mode).
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline && !(await fileExists(metadataPath))) {
    await delay(POLL_INTERVAL_MS)
  }
  assert(await fileExists(metadataPath), `no metadata at ${metadataPath}`)

  const backend =
    options.backend ?? createOcrBackend(engine, options.backendOptions)
  console.log(`using OCR backend: ${backend.name}`)

  // Build a TOC lookup the first time we see a non-empty metadata file.
  let pageToTocItemMap: Record<number, TocItem> | undefined

  const completed = new Map<number, ContentChunk>()
  const failed = new Set<number>()
  const inFlight = new Set<number>()
  let extractDone = false

  // Poll metadata.json, dispatch newly-seen pages, stop when extract
  // signalled .done and everything outstanding has finished one way or
  // another.
  while (true) {
    const metadata = await tryReadJsonFile<BookMetadata>(metadataPath)
    if (!metadata?.pages?.length) {
      if (await fileExists(donePath)) break
      await delay(POLL_INTERVAL_MS)
      continue
    }

    if (!pageToTocItemMap && metadata.toc?.length) {
      pageToTocItemMap = metadata.toc.reduce(
        (acc: Record<number, TocItem>, tocItem) => {
          if (tocItem.page !== undefined) acc[tocItem.page] = tocItem
          return acc
        },
        {}
      )
    }

    // When maxPages is set, only consider the first N pages — this lets
    // you run an OCR eval against a small sample without transcribing a
    // whole book.
    const pagesToProcess =
      maxPages !== undefined
        ? metadata.pages.slice(0, maxPages)
        : metadata.pages

    for (const pageChunk of pagesToProcess) {
      if (completed.has(pageChunk.index)) continue
      if (failed.has(pageChunk.index)) continue
      if (inFlight.has(pageChunk.index)) continue
      if (inFlight.size >= TRANSCRIBE_CONCURRENCY) break

      inFlight.add(pageChunk.index)
      const prevPage = metadata.pages[pageChunk.index - 1]

      void transcribePage(
        backend,
        pageChunk,
        prevPage,
        pageToTocItemMap ?? {},
        format
      )
        .then((result) => {
          if (result) completed.set(pageChunk.index, result)
          else failed.add(pageChunk.index)
        })
        .catch((error: unknown) => {
          console.error(
            `error processing image ${pageChunk.index} (${pageChunk.screenshot})`,
            error
          )
          failed.add(pageChunk.index)
        })
        .finally(() => inFlight.delete(pageChunk.index))
    }

    if (!extractDone && (await fileExists(donePath))) {
      extractDone = true
    }

    // Early exit once maxPages pages are accounted for, even while
    // extract is still screenshotting the rest of the book.
    const totalAccountedFor = completed.size + failed.size
    if (
      maxPages !== undefined &&
      inFlight.size === 0 &&
      totalAccountedFor >= Math.min(maxPages, metadata.pages.length) &&
      // ...but only when we've actually seen that many pages in metadata.
      pagesToProcess.length >= maxPages
    ) {
      break
    }

    if (
      extractDone &&
      inFlight.size === 0 &&
      totalAccountedFor >= pagesToProcess.length
    ) {
      break
    }

    await delay(POLL_INTERVAL_MS)
  }

  const content = [...completed.values()].toSorted((a, b) => a.index - b.index)

  // Stitch words that got split across a page boundary by the renderer's
  // word-wrap hyphen (e.g. "fort-\n schreitet" → "fortschreitet").
  dehyphenateAcrossPages(content)

  if (failed.size > 0 && !allowPartial) {
    throw new Error(
      `transcription failed for ${failed.size} page(s); refusing to write a partial content.json. Re-run with --allow-partial to keep successful pages.`
    )
  }

  await fs.writeFile(
    path.join(bookDir, 'content.json'),
    JSON.stringify(content, null, 2)
  )

  if (failed.size > 0) {
    console.warn(
      `warning: ${failed.size} page(s) failed to transcribe and were omitted`
    )
  }
  console.log(`wrote ${content.length} pages to ${bookDir}/content.json`)
}
