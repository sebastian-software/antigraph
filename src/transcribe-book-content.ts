import fs from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

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

interface TranscribePageOptions {
  backend: OcrBackend
  pageChunk: PageChunk
  prevPage: PageChunk | undefined
  pageToTocItemMap: Record<number, TocItem>
  format: OcrFormat
}

async function transcribePage({
  backend,
  pageChunk,
  prevPage,
  pageToTocItemMap,
  format
}: TranscribePageOptions): Promise<ContentChunk | undefined> {
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

function buildPageToTocItemMap(
  metadata: BookMetadata
): Record<number, TocItem> | undefined {
  if (!metadata.toc?.length) return undefined

  return metadata.toc.reduce((acc: Record<number, TocItem>, tocItem) => {
    if (tocItem.page !== undefined) acc[tocItem.page] = tocItem
    return acc
  }, {})
}

function getPagesToProcess(
  pages: PageChunk[],
  maxPages: number | undefined
): PageChunk[] {
  return maxPages !== undefined ? pages.slice(0, maxPages) : pages
}

interface TranscribeQueues {
  completed: Map<number, ContentChunk>
  failed: Set<number>
  inFlight: Set<number>
}

async function waitForInitialMetadata(metadataPath: string): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline && !(await fileExists(metadataPath))) {
    await delay(POLL_INTERVAL_MS)
  }
  assert(await fileExists(metadataPath), `no metadata at ${metadataPath}`)
}

function queueNeedsWork(
  pageChunk: PageChunk,
  { completed, failed, inFlight }: TranscribeQueues
): boolean {
  if (completed.has(pageChunk.index)) return false
  if (failed.has(pageChunk.index)) return false
  if (inFlight.has(pageChunk.index)) return false
  return true
}

function queueTranscription({
  backend,
  metadata,
  pageChunk,
  pageToTocItemMap,
  format,
  queues
}: {
  backend: OcrBackend
  metadata: BookMetadata
  pageChunk: PageChunk
  pageToTocItemMap: Record<number, TocItem>
  format: OcrFormat
  queues: TranscribeQueues
}): void {
  const { completed, failed, inFlight } = queues
  inFlight.add(pageChunk.index)
  const prevPage = metadata.pages?.[pageChunk.index - 1]

  void transcribePage({
    backend,
    pageChunk,
    prevPage,
    pageToTocItemMap,
    format
  })
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
    .finally(() => {
      inFlight.delete(pageChunk.index)
    })
}

function dispatchPendingPages({
  backend,
  metadata,
  pagesToProcess,
  pageToTocItemMap,
  format,
  queues
}: {
  backend: OcrBackend
  metadata: BookMetadata
  pagesToProcess: PageChunk[]
  pageToTocItemMap: Record<number, TocItem>
  format: OcrFormat
  queues: TranscribeQueues
}): void {
  for (const pageChunk of pagesToProcess) {
    if (!queueNeedsWork(pageChunk, queues)) continue
    if (queues.inFlight.size >= TRANSCRIBE_CONCURRENCY) break

    queueTranscription({
      backend,
      metadata,
      pageChunk,
      pageToTocItemMap,
      format,
      queues
    })
  }
}

function shouldStopPolling({
  maxPages,
  metadataPageCount,
  pagesToProcessLength,
  completed,
  failed,
  inFlight,
  extractDone
}: {
  maxPages: number | undefined
  metadataPageCount: number
  pagesToProcessLength: number
  completed: Map<number, ContentChunk>
  failed: Set<number>
  inFlight: Set<number>
  extractDone: boolean
}): boolean {
  const totalAccountedFor = completed.size + failed.size

  if (
    maxPages !== undefined &&
    inFlight.size === 0 &&
    totalAccountedFor >= Math.min(maxPages, metadataPageCount) &&
    pagesToProcessLength >= maxPages
  ) {
    return true
  }

  return (
    extractDone &&
    inFlight.size === 0 &&
    totalAccountedFor >= pagesToProcessLength
  )
}

export async function runTranscribe(options: TranscribeOptions): Promise<void> {
  const { asin, outDir, engine, maxPages } = options
  const format = options.format ?? 'plain'
  const allowPartial = options.allowPartial ?? false
  const bookDir = path.join(outDir, asin)
  const metadataPath = path.join(bookDir, 'metadata.json')
  const donePath = path.join(bookDir, '.done')

  await waitForInitialMetadata(metadataPath)

  const backend =
    options.backend ?? createOcrBackend(engine, options.backendOptions)
  console.log(`using OCR backend: ${backend.name}`)

  // Build a TOC lookup the first time we see a non-empty metadata file.
  let pageToTocItemMap: Record<number, TocItem> | undefined

  const queues: TranscribeQueues = {
    completed: new Map<number, ContentChunk>(),
    failed: new Set<number>(),
    inFlight: new Set<number>()
  }
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

    pageToTocItemMap ??= buildPageToTocItemMap(metadata)

    const pagesToProcess = getPagesToProcess(metadata.pages, maxPages)

    dispatchPendingPages({
      backend,
      metadata,
      pagesToProcess,
      pageToTocItemMap: pageToTocItemMap ?? {},
      format,
      queues
    })

    if (!extractDone && (await fileExists(donePath))) {
      extractDone = true
    }

    if (
      shouldStopPolling({
        maxPages,
        metadataPageCount: metadata.pages.length,
        pagesToProcessLength: pagesToProcess.length,
        completed: queues.completed,
        failed: queues.failed,
        inFlight: queues.inFlight,
        extractDone
      })
    ) {
      break
    }

    await delay(POLL_INTERVAL_MS)
  }

  const content = [...queues.completed.values()].toSorted(
    (a, b) => a.index - b.index
  )

  // Stitch words that got split across a page boundary by the renderer's
  // word-wrap hyphen (e.g. "fort-\n schreitet" → "fortschreitet").
  dehyphenateAcrossPages(content)

  if (queues.failed.size > 0 && !allowPartial) {
    throw new Error(
      `transcription failed for ${queues.failed.size} page(s); refusing to write a partial content.json. Re-run with --allow-partial to keep successful pages.`
    )
  }

  await fs.writeFile(
    path.join(bookDir, 'content.json'),
    JSON.stringify(content, null, 2)
  )

  if (queues.failed.size > 0) {
    console.warn(
      `warning: ${queues.failed.size} page(s) failed to transcribe and were omitted`
    )
  }
  console.log(`wrote ${content.length} pages to ${bookDir}/content.json`)
}
