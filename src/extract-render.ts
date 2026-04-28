import type { Page } from 'patchright'

import fs from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import pRace from 'p-race'
import sharp from 'sharp'

import type { AmazonRenderToc, AmazonRenderTocItem, TocItem } from './types'

import {
  attachReaderResponseHandlers,
  blockAnalyticsRequests,
  type CapturedBlob,
  createBlobCapture,
  type ExtractMetadataDraft,
  writeResultMetadata
} from './extract-network'
import {
  advanceToNextPage,
  ensureSignedIntoBook,
  getPageNav
} from './extract-reader'
import { parseTocItems } from './playwright-utils'
import { assert } from './utils'

export type RenderMethod = 'blob' | 'screenshot'

function getPageForPosition(
  locationMap: ExtractMetadataDraft['locationMap'],
  position: number
): number {
  if (!locationMap) return -1

  let resultPage = 1
  for (const {
    startPosition,
    page: navigationPage
  } of locationMap.navigationUnit) {
    if (startPosition > position) break
    resultPage = navigationPage
  }

  return resultPage
}

function getTocItems(
  rawTocItem: AmazonRenderTocItem,
  getPageForPositionForResult: (position: number) => number,
  depth = 0
): TocItem[] {
  const positionId = rawTocItem.tocPositionId
  const tocItem: TocItem = {
    label: rawTocItem.label,
    positionId,
    page: getPageForPositionForResult(positionId),
    depth
  }

  const tocItems: TocItem[] = [tocItem]
  if (!rawTocItem.entries) return tocItems

  for (const rawTocItemEntry of rawTocItem.entries) {
    tocItems.push(
      ...getTocItems(rawTocItemEntry, getPageForPositionForResult, depth + 1)
    )
  }

  return tocItems
}

async function captureRenderedPageImage({
  page,
  imageSelector,
  src,
  capturedBlobs,
  deviceScaleFactor,
  renderMethod
}: {
  page: Page
  imageSelector: string
  src: string
  capturedBlobs: Map<string, CapturedBlob>
  deviceScaleFactor: number
  renderMethod: RenderMethod
}): Promise<Buffer> {
  if (renderMethod === 'blob') {
    const blob = await pRace<CapturedBlob | undefined>((signal) => [
      (async (): Promise<CapturedBlob | undefined> => {
        while (!signal.aborted) {
          const capturedBlob = capturedBlobs.get(src)
          if (capturedBlob) {
            capturedBlobs.delete(src)
            return capturedBlob
          }

          await delay(1)
        }

        return undefined
      })(),

      delay(10_000, undefined, { signal })
    ])

    assert(blob, `no blob found for src: ${src}`)

    const rawRenderedImage = Buffer.from(blob.base64, 'base64')
    const sharpInstance = sharp(rawRenderedImage)
    const metadata = await sharpInstance.metadata()
    return sharpInstance
      .resize({
        width: Math.floor(metadata.width / deviceScaleFactor),
        height: Math.floor(metadata.height / deviceScaleFactor)
      })
      .webp({ quality: 85 })
      .toBuffer()
  }

  const rawScreenshot = await page
    .locator(imageSelector)
    .screenshot({ type: 'png', scale: 'css' })
  return sharp(rawScreenshot).webp({ quality: 85 }).toBuffer()
}

export function finalizePendingToc(
  result: ExtractMetadataDraft,
  pendingRawToc: AmazonRenderToc
): TocItem[] | undefined {
  if (!result.locationMap || result.toc) return undefined

  return pendingRawToc.flatMap((rawTocItem) =>
    getTocItems(rawTocItem, (position) =>
      getPageForPosition(result.locationMap, position)
    )
  )
}

export function finalizeNavigationMetadata(
  result: ExtractMetadataDraft
): number {
  assert(result.meta, 'expected book meta to be initialized')
  assert(result.toc?.length, 'expected book toc to be initialized')
  assert(result.locationMap, 'expected book location map to be initialized')

  result.nav.startContentPosition = result.meta.startPosition
  result.nav.totalNumPages = result.locationMap.navigationUnit.reduce(
    (acc, navUnit) => Math.max(acc, navUnit.page),
    -1
  )
  assert(result.nav.totalNumPages > 0, 'parsed book nav has no pages')
  result.nav.startContentPage = getPageForPosition(
    result.locationMap,
    result.nav.startContentPosition
  )

  const parsedToc = parseTocItems(result.toc, {
    totalNumPages: result.nav.totalNumPages
  })
  result.nav.endContentPage =
    parsedToc.firstPostContentPageTocItem?.page ?? result.nav.totalNumPages
  result.nav.endContentPosition =
    parsedToc.firstPostContentPageTocItem?.positionId ?? result.nav.endPosition
  result.nav.totalNumContentPages = Math.min(
    parsedToc.firstPostContentPageTocItem?.page ?? result.nav.totalNumPages,
    result.nav.totalNumPages
  )
  assert(result.nav.totalNumContentPages > 0, 'No content pages found')

  return `${result.nav.totalNumContentPages * 2}`.length
}

export async function setupReaderSession({
  page,
  context,
  asin,
  bookDir,
  result,
  bookReaderUrl,
  headless,
  renderMethod,
  onRawToc
}: {
  page: Page
  context: Parameters<typeof createBlobCapture>[0]
  asin: string
  bookDir: string
  result: ExtractMetadataDraft
  bookReaderUrl: string
  headless: boolean
  renderMethod: RenderMethod
  onRawToc: (rawToc: AmazonRenderToc) => void
}): Promise<Map<string, CapturedBlob>> {
  await blockAnalyticsRequests(page)
  attachReaderResponseHandlers({
    page,
    asin,
    bookDir,
    result,
    onRawToc
  })

  const capturedBlobs =
    renderMethod === 'blob'
      ? await createBlobCapture(context, page)
      : new Map<string, CapturedBlob>()

  await Promise.any([
    page.goto(bookReaderUrl, { timeout: 30_000 }),
    page.waitForURL('**/ap/signin', { timeout: 30_000 })
  ])
  await ensureSignedIntoBook(page, bookReaderUrl, headless)

  return capturedBlobs
}

export async function captureContentPages({
  page,
  result,
  pageScreenshotsDir,
  pageNumberPaddingAmount,
  maxPages,
  imageSelector,
  metadataPath,
  capturedBlobs,
  deviceScaleFactor,
  renderMethod
}: {
  page: Page
  result: ExtractMetadataDraft
  pageScreenshotsDir: string
  pageNumberPaddingAmount: number
  maxPages: number | undefined
  imageSelector: string
  metadataPath: string
  capturedBlobs: Map<string, CapturedBlob>
  deviceScaleFactor: number
  renderMethod: RenderMethod
}): Promise<void> {
  console.warn(
    `\nreading ${result.nav.totalNumContentPages} content pages out of ${result.nav.totalNumPages} total pages...\n`
  )

  for (;;) {
    const pageNav = await getPageNav(page)
    if (pageNav?.page === undefined) break
    if (pageNav.page > result.nav.totalNumContentPages) break

    const index = result.pages.length
    const src = (await page.locator(imageSelector).getAttribute('src'))!
    const renderedPageImageBuffer = await captureRenderedPageImage({
      page,
      imageSelector,
      src,
      capturedBlobs,
      deviceScaleFactor,
      renderMethod
    })

    const screenshotPath = path.join(
      pageScreenshotsDir,
      `${`${index}`.padStart(pageNumberPaddingAmount, '0')}-${`${pageNav.page}`.padStart(pageNumberPaddingAmount, '0')}.webp`
    )

    await fs.writeFile(screenshotPath, renderedPageImageBuffer)
    const pageChunk = { index, page: pageNav.page, screenshot: screenshotPath }
    result.pages.push(pageChunk)
    console.warn(pageChunk)
    await writeResultMetadata(metadataPath, result)

    if (pageNav.page >= result.nav.totalNumContentPages) break
    if (maxPages !== undefined && result.pages.length >= maxPages) {
      console.warn(`MAX_PAGES=${maxPages} reached — stopping early.`)
      break
    }

    const advanced = await advanceToNextPage({
      page,
      imageSelector,
      src,
      pageNav
    })
    if (!advanced) break
  }
}
