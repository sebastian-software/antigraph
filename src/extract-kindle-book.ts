import fs from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import pRace from 'p-race'
import sharp from 'sharp'

import type { AmazonRenderToc, AmazonRenderTocItem, TocItem } from './types'
import {
  authDataDir,
  closeBrowserContext,
  launchKindleContext,
  pickAsin
} from './extract-browser'
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
  ensureReaderUiReady,
  ensureSignedIntoBook,
  getPageNav,
  goToPage
} from './extract-reader'
import { parseTocItems } from './playwright-utils'
import { assert } from './utils'

export interface ExtractOptions {
  /**
   * Kindle ASIN. When undefined, the extractor opens a visible Chrome
   * window, waits for the user to sign in and click a book in the
   * Kindle library, and then proceeds with whatever ASIN that yields.
   */
  asin?: string
  /**
   * Where to write `<outDir>/<asin>/pages/*.webp`, `metadata.json`, and
   * the Chrome auth profile at `<outDir>/.auth/data`.
   */
  outDir: string
  /**
   * Cap page capture at this number — useful for smoke-testing a new
   * book or an extract-logic change without running on a whole novel.
   */
  maxPages?: number
  /**
   * Run the page-capture browser headless after the picker (the picker
   * is always visible because it needs manual sign-in + book click).
   * Default: true. Set to false to watch Chrome flip through pages when
   * debugging selector/navigation problems.
   */
  headless?: boolean
}

type RENDER_METHOD = 'screenshot' | 'blob'
const renderMethod: RENDER_METHOD = 'blob'

/**
 * Run the page-capture stage. Returns the ASIN that was processed —
 * useful when the caller didn't know it up-front and a picker was used.
 */
export async function runExtract(options: ExtractOptions): Promise<string> {
  const { outDir, maxPages } = options
  const headless = options.headless ?? true,
    trimmedAsin = options.asin?.trim()
  const asin =
    trimmedAsin === undefined || trimmedAsin === ''
      ? await pickAsin(outDir)
      : trimmedAsin
  const authUserDataDir = authDataDir(outDir)
  const bookDir = path.join(outDir, asin)
  const pageScreenshotsDir = path.join(bookDir, 'pages')
  const metadataPath = path.join(bookDir, 'metadata.json')
  const donePath = path.join(bookDir, '.done')
  await fs.mkdir(authUserDataDir, { recursive: true })
  await fs.mkdir(pageScreenshotsDir, { recursive: true })
  // Clear any stale done marker from a prior run of this book so a
  // concurrently running transcribe (during `all` mode) doesn't exit
  // early.
  await fs.rm(donePath, { force: true })

  const krRendererMainImageSelector = '#kr-renderer .kg-full-page-img img',
    bookReaderUrl = `https://read.amazon.com/?asin=${asin}`

  const result: ExtractMetadataDraft = {
    pages: [],
    // locationMap: { locations: [], navigationUnit: [] },
    nav: {
      startPosition: -1,
      endPosition: -1,
      startContentPosition: -1,
      startContentPage: -1,
      endContentPosition: -1,
      endContentPage: -1,
      totalNumPages: -1,
      totalNumContentPages: -1
    }
  }

  const deviceScaleFactor = 2
  const context = await launchKindleContext(authUserDataDir, {
    headless,
    deviceScaleFactor
  })

  try {
    const page = context.pages()[0] ?? (await context.newPage())

    console.log(
      headless
        ? `→ Extracting ASIN=${asin} in headless mode. Pass --no-headless to watch the browser.`
        : `→ Extracting ASIN=${asin} with a visible browser window.`
    )

    // Amazon's /renderer/render endpoint returns the location map, the TOC,
    // and per-chunk metadata in separate TAR responses, and the order isn't
    // guaranteed. The TOC needs the location map to resolve page numbers,
    // so we keep the raw TOC around until both have arrived.
    let pendingRawToc: AmazonRenderToc | undefined

    function tryFinalizeToc() {
      if (!pendingRawToc || !result.locationMap || result.toc) return
      const toc: TocItem[] = []
      for (const rawTocItem of pendingRawToc) {
        toc.push(...getTocItems(rawTocItem, { depth: 0 }))
      }
      result.toc = toc
      pendingRawToc = undefined
    }

    await blockAnalyticsRequests(page)
    attachReaderResponseHandlers({
      page,
      asin,
      bookDir,
      result,
      onRawToc: (rawToc) => {
        pendingRawToc = rawToc
        tryFinalizeToc()
      }
    })

    // Only used for the 'blob' render method
    const capturedBlobs =
      renderMethod === 'blob'
        ? await createBlobCapture(context, page)
        : new Map<string, CapturedBlob>()

    // Try going directly to the book reader page if we're already authenticated.
    // Otherwise wait for the signin page to load.
    await Promise.any([
      page.goto(bookReaderUrl, { timeout: 30_000 }),
      page.waitForURL('**/ap/signin', { timeout: 30_000 })
    ])

    // Session expired between picker and main launch — unlikely given we share
    // the auth profile, but handle it gracefully: wait for the user to sign in
    // manually, then navigate to the book. In headless mode we can't show a
    // login page to the user, so abort with a clear message instead of hanging.
    await ensureSignedIntoBook(page, bookReaderUrl, headless)

    function getTocItems(
      rawTocItem: AmazonRenderTocItem,
      { depth = 0 }: { depth?: number } = {}
    ): TocItem[] {
      const positionId = rawTocItem.tocPositionId
      const tocPage = getPageForPosition(positionId)

      const tocItem: TocItem = {
        label: rawTocItem.label,
        positionId,
        page: tocPage,
        depth
      }

      const tocItems: TocItem[] = [tocItem]

      if (rawTocItem.entries) {
        for (const rawTocItemEntry of rawTocItem.entries) {
          tocItems.push(...getTocItems(rawTocItemEntry, { depth: depth + 1 }))
        }
      }

      return tocItems
    }

    function getPageForPosition(position: number): number {
      if (!result.locationMap) return -1

      let resultPage = 1

      // TODO: this is O(n) but we can do better
      for (const { startPosition, page: navigationPage } of result.locationMap
        .navigationUnit) {
        if (startPosition > position) break

        resultPage = navigationPage
      }

      return resultPage
    }

    await ensureReaderUiReady(page)

    console.log('Waiting for book reader to load...')
    await page
      .waitForSelector(krRendererMainImageSelector, { timeout: 60_000 })
      .catch(() => {
        console.warn(
          'Main reader content may not have loaded, continuing anyway...'
        )
      })

    // Record the initial page navigation so we can reset back to it later
    const initialPageNav = await getPageNav(page)

    // At this point, we should have recorded all the base book metadata from the
    // initial network requests.
    assert(result.info, 'expected book info to be initialized')
    assert(result.meta, 'expected book meta to be initialized')
    assert(
      result.toc?.length,
      `expected book toc to be initialized (raw toc seen: ${!!pendingRawToc}, location map seen: ${!!result.locationMap}) — try re-running, Amazon sometimes skips the toc render on the first visit after a cold sign-in`
    )
    assert(result.locationMap, 'expected book location map to be initialized')

    result.nav.startContentPosition = result.meta.startPosition
    result.nav.totalNumPages = result.locationMap.navigationUnit.reduce(
      (acc, navUnit) => {
        return Math.max(acc, navUnit.page ?? -1)
      },
      -1
    )
    assert(result.nav.totalNumPages > 0, 'parsed book nav has no pages')
    result.nav.startContentPage = getPageForPosition(
      result.nav.startContentPosition
    )

    const parsedToc = parseTocItems(result.toc, {
      totalNumPages: result.nav.totalNumPages
    })
    result.nav.endContentPage =
      parsedToc.firstPostContentPageTocItem?.page ?? result.nav.totalNumPages
    result.nav.endContentPosition =
      parsedToc.firstPostContentPageTocItem?.positionId ??
      result.nav.endPosition

    result.nav.totalNumContentPages = Math.min(
      parsedToc.firstPostContentPageTocItem?.page ?? result.nav.totalNumPages,
      result.nav.totalNumPages
    )
    assert(result.nav.totalNumContentPages > 0, 'No content pages found')
    const pageNumberPaddingAmount = `${result.nav.totalNumContentPages * 2}`
      .length
    await writeResultMetadata(metadataPath, result)

    // Navigate to the first content page of the book
    await goToPage(page, result.nav.startContentPage)

    let done = false
    console.warn(
      `\nreading ${result.nav.totalNumContentPages} content pages out of ${result.nav.totalNumPages} total pages...\n`
    )

    // Loop through each page of the book
    do {
      const pageNav = await getPageNav(page)

      if (pageNav?.page === undefined) {
        break
      }

      if (pageNav.page > result.nav.totalNumContentPages) {
        break
      }

      const index = result.pages.length

      const src = (await page
        .locator(krRendererMainImageSelector)
        .getAttribute('src'))!

      let renderedPageImageBuffer: Buffer | undefined

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

        assert(
          blob,
          `no blob found for src: ${src} (index ${index}; page ${pageNav.page})`
        )

        const rawRenderedImage = Buffer.from(blob.base64, 'base64')
        const c = sharp(rawRenderedImage)
        const m = await c.metadata()
        renderedPageImageBuffer = await c
          .resize({
            width: Math.floor(m.width / deviceScaleFactor),
            height: Math.floor(m.height / deviceScaleFactor)
          })
          .webp({ quality: 85 })
          .toBuffer()
      } else {
        const rawScreenshot = await page
          .locator(krRendererMainImageSelector)
          .screenshot({ type: 'png', scale: 'css' })
        renderedPageImageBuffer = await sharp(rawScreenshot)
          .webp({ quality: 85 })
          .toBuffer()
      }

      assert(
        renderedPageImageBuffer,
        `no buffer found for src: ${src} (index ${index}; page ${pageNav.page})`
      )

      const screenshotPath = path.join(
        pageScreenshotsDir,
        `${`${index}`.padStart(pageNumberPaddingAmount, '0')}-${`${pageNav.page}`.padStart(pageNumberPaddingAmount, '0')}.webp`
      )

      await fs.writeFile(screenshotPath, renderedPageImageBuffer)
      const pageChunk = {
        index,
        page: pageNav.page,
        screenshot: screenshotPath
      }
      result.pages.push(pageChunk)
      console.warn(pageChunk)
      await writeResultMetadata(metadataPath, result)

      // We just wrote the last content page — don't bother trying to advance,
      // Amazon disables the next-page chevron here and the retry loop below
      // would otherwise spend ~3 minutes failing to click it.
      if (pageNav.page >= result.nav.totalNumContentPages) {
        done = true
        break
      }

      // MAX_PAGES is there so you can do a quick 3-page evaluation run
      // without screenshotting a whole novel — stop as soon as we've
      // captured that many.
      if (maxPages !== undefined && result.pages.length >= maxPages) {
        console.warn(`MAX_PAGES=${maxPages} reached — stopping early.`)
        done = true
        break
      }

      if (
        !(await advanceToNextPage({
          page,
          imageSelector: krRendererMainImageSelector,
          src,
          pageNav
        }))
      ) {
        done = true
        break
      }
    } while (!done)

    await writeResultMetadata(metadataPath, result)
    console.log()
    console.log(metadataPath)

    if (initialPageNav?.page !== undefined) {
      console.warn(`resetting back to initial page ${initialPageNav.page}...`)
      // Reset back to the initial page
      await goToPage(page, initialPageNav.page)
    }

    // Signal to a concurrent transcribe (during `all` mode) that no more
    // pages are coming. Also acts as the idempotency marker for the CLI:
    // a future run with the same ASIN will skip extract if .done exists.
    await fs.writeFile(donePath, '')

    return asin
  } finally {
    await closeBrowserContext(context)
  }
}
