import type { BrowserContext, Page, Response } from 'patchright'

import fs from 'node:fs/promises'
import path from 'node:path'

import type {
  AmazonBookInfo,
  AmazonBookMeta,
  AmazonRenderLocationMap,
  AmazonRenderToc,
  BookMetadata
} from './types'

import {
  extractTar,
  hashObject,
  normalizeAuthors,
  normalizeBookMetadata,
  parseJsonpResponse,
  parsePageLabel,
  tryReadJsonFile
} from './utils'

const urlRegexBlacklist = [
  /unagi-\w+\.amazon\.com/i,
  /m\.media-amazon\.com.*\/showads/i,
  /fls-na\.amazon\.com.*\/remote-weblab-triggers/i
]

export interface CapturedBlob {
  type: string
  base64: string
}

export type ExtractMetadataDraft = Partial<BookMetadata> &
  Pick<BookMetadata, 'nav' | 'pages'>

type AmazonBookMetaJson = {
  authorsList?: string[]
  cpr?: unknown
} & AmazonBookMeta

type AmazonBookInfoJson = {
  karamelToken?: unknown
  metadataUrl?: unknown
  YJFormatVersion?: unknown
} & AmazonBookInfo

interface RenderMetadataJson {
  firstPositionId?: number
  lastPositionId?: number
}

interface AttachReaderResponseHandlersOptions {
  page: Page
  asin: string
  bookDir: string
  result: ExtractMetadataDraft
  onRawToc: (rawToc: AmazonRenderToc) => void
}

interface ReaderResponseHandlerContext extends Omit<
  AttachReaderResponseHandlersOptions,
  'page'
> {
  asinL: string
}

function normalizeLocationMap(
  locationMap: AmazonRenderLocationMap
): AmazonRenderLocationMap {
  return {
    ...locationMap,
    navigationUnit: locationMap.navigationUnit.flatMap((navUnit) => {
      const parsedPage = parsePageLabel(navUnit.label)
      if (Number.isNaN(parsedPage)) {
        console.warn(
          `locationMap: dropping entry with unparseable label "${navUnit.label}"`
        )
        return []
      }
      return [{ ...navUnit, page: parsedPage }]
    })
  }
}

export async function blockAnalyticsRequests(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    const urlString = route.request().url()
    for (const regex of urlRegexBlacklist) {
      if (regex.test(urlString)) {
        return route.abort()
      }
    }
    return route.continue()
  })
}

export function attachReaderResponseHandlers({
  page,
  asin,
  bookDir,
  result,
  onRawToc
}: AttachReaderResponseHandlersOptions): void {
  const handlerContext = {
    asin,
    asinL: asin.toLowerCase(),
    bookDir,
    result,
    onRawToc
  }

  page.on('response', async (response) => {
    try {
      await handleReaderResponse(response, handlerContext)
    } catch (error) {
      console.warn('response handler error:', error)
    }
  })
}

function isReaderResponse(url: URL, asinL: string): boolean {
  return (
    url.hostname === 'read.amazon.com' &&
    url.searchParams.get('asin')?.toLowerCase() === asinL
  )
}

async function handleBookMetadataResponse(
  response: Response,
  { asin, result }: ReaderResponseHandlerContext
): Promise<void> {
  const body = await response.text()
  const metadata = parseJsonpResponse(body) as AmazonBookMetaJson | undefined
  if (metadata?.asin !== asin) return

  delete metadata.cpr
  if (Array.isArray(metadata.authorsList)) {
    metadata.authorsList = normalizeAuthors(metadata.authorsList)
  }

  if (!result.meta) {
    console.warn('book meta', metadata)
    result.meta = metadata
  }
}

async function handleStartReadingResponse(
  response: Response,
  { result }: ReaderResponseHandlerContext
): Promise<void> {
  const body = (await response.json()) as AmazonBookInfoJson
  delete body.karamelToken
  delete body.metadataUrl
  delete body.YJFormatVersion
  if (!result.info) {
    console.warn('book info', body)
  }
  result.info = body
}

async function handleRenderResponse(
  response: Response,
  url: URL,
  { bookDir, result, onRawToc }: ReaderResponseHandlerContext
): Promise<void> {
  const params = Object.fromEntries(url.searchParams.entries())
  const hash = hashObject(params)
  const renderDir = path.join(bookDir, 'render', hash)
  await fs.mkdir(renderDir, { recursive: true })
  const body = await response.body()
  const tempDir = await extractTar(body, { cwd: renderDir })
  const { startingPosition, skipPageCount, numPage } = params
  console.log('RENDER TAR', tempDir, {
    startingPosition,
    skipPageCount,
    numPage
  })

  await updateRenderMetadata(renderDir, result, onRawToc)
}

async function updateRenderMetadata(
  renderDir: string,
  result: ExtractMetadataDraft,
  onRawToc: (rawToc: AmazonRenderToc) => void
): Promise<void> {
  const locationMap = await tryReadJsonFile<AmazonRenderLocationMap>(
    path.join(renderDir, 'location_map.json')
  )
  if (locationMap) {
    result.locationMap = normalizeLocationMap(locationMap)
  }

  const metadata = await tryReadJsonFile<RenderMetadataJson>(
    path.join(renderDir, 'metadata.json')
  )
  if (
    metadata?.firstPositionId !== undefined &&
    metadata.lastPositionId !== undefined
  ) {
    result.nav.startPosition = metadata.firstPositionId
    result.nav.endPosition = metadata.lastPositionId
  }

  const rawToc = await tryReadJsonFile<AmazonRenderToc>(
    path.join(renderDir, 'toc.json')
  )
  if (rawToc && !result.toc) {
    onRawToc(rawToc)
  }
}

async function handleReaderResponse(
  response: Response,
  context: ReaderResponseHandlerContext
): Promise<void> {
  if (response.status() !== 200) return

  const url = new URL(response.url())
  if (url.pathname.endsWith('YJmetadata.jsonp')) {
    await handleBookMetadataResponse(response, context)
    return
  }

  if (!isReaderResponse(url, context.asinL)) return
  if (url.pathname === '/service/mobile/reader/startReading') {
    await handleStartReadingResponse(response, context)
    return
  }

  if (url.pathname === '/renderer/render') {
    await handleRenderResponse(response, url, context)
  }
}

export async function createBlobCapture(
  context: BrowserContext,
  page: Page
): Promise<Map<string, CapturedBlob>> {
  const capturedBlobs = new Map<string, CapturedBlob>()

  await page.exposeFunction('nodeLog', (...args: unknown[]) => {
    console.error('[page]', ...args)
  })

  await page.exposeBinding('captureBlob', (_source, url, payload) => {
    capturedBlobs.set(url, payload)
  })

  await context.addInitScript(() => {
    const origCreateObjectURL = URL.createObjectURL.bind(URL)
    URL.createObjectURL = function (blob: Blob) {
      const type = blob.type || 'application/octet-stream'
      const url = origCreateObjectURL(blob)

      void (async () => {
        const buf = await blob.arrayBuffer()
        let binary = ''
        const bytes = new Uint8Array(buf)
        for (const byte of bytes) {
          binary += String.fromCharCode(byte)
        }

        const base64 = btoa(binary)

        // @ts-expect-error captureBlob
        captureBlob(url, { type, base64 })
      })()

      return url
    }
  })

  return capturedBlobs
}

export async function writeResultMetadata(
  metadataPath: string,
  result: ExtractMetadataDraft
): Promise<void> {
  await fs.writeFile(
    metadataPath,
    JSON.stringify(normalizeBookMetadata(result), null, 2)
  )
}
