import type { Page } from 'patchright'

import fs from 'node:fs/promises'
import path from 'node:path'

import type { PageNav } from './types'

import {
  authDataDir,
  closeBrowserContext,
  launchKindleContext,
  pickAsin
} from './extract-browser'
import {
  type ExtractMetadataDraft,
  writeResultMetadata
} from './extract-network'
import { ensureReaderUiReady, getPageNav, goToPage } from './extract-reader'
import {
  captureContentPages,
  finalizeNavigationMetadata,
  finalizePendingToc,
  setupReaderSession
} from './extract-render'
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

type RENDER_METHOD = 'blob' | 'screenshot'
const renderMethod: RENDER_METHOD = 'blob'

interface PreparedExtractRun {
  asin: string
  authUserDataDir: string
  bookDir: string
  pageScreenshotsDir: string
  metadataPath: string
  donePath: string
  result: ExtractMetadataDraft
}

async function prepareExtractRun({
  outDir,
  asin
}: {
  outDir: string
  asin: string
}): Promise<PreparedExtractRun> {
  const authUserDataDir = authDataDir(outDir)
  const bookDir = path.join(outDir, asin)
  const pageScreenshotsDir = path.join(bookDir, 'pages')
  const metadataPath = path.join(bookDir, 'metadata.json')
  const donePath = path.join(bookDir, '.done')
  await fs.mkdir(authUserDataDir, { recursive: true })
  await fs.mkdir(pageScreenshotsDir, { recursive: true })
  await fs.rm(donePath, { force: true })

  return {
    asin,
    authUserDataDir,
    bookDir,
    pageScreenshotsDir,
    metadataPath,
    donePath,
    result: createInitialExtractMetadata()
  }
}

function createInitialExtractMetadata(): ExtractMetadataDraft {
  return {
    pages: [],
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
}

function createPendingTocTracker(result: ExtractMetadataDraft): {
  hasPendingRawToc: () => boolean
  setRawToc: Parameters<typeof setupReaderSession>[0]['onRawToc']
} {
  let pendingRawToc: Parameters<
    typeof setupReaderSession
  >[0]['onRawToc'] extends (rawToc: infer T) => void
    ? T | undefined
    : never

  function tryFinalizeToc() {
    if (!pendingRawToc || !result.locationMap || result.toc) return
    const finalizedToc = finalizePendingToc(result, pendingRawToc)
    if (!finalizedToc) return
    result.toc = finalizedToc
    pendingRawToc = undefined
  }

  return {
    hasPendingRawToc: () => pendingRawToc !== undefined,
    setRawToc(rawToc) {
      pendingRawToc = rawToc
      tryFinalizeToc()
    }
  }
}

async function waitForReaderContent(page: Page, imageSelector: string) {
  console.log('Waiting for book reader to load...')
  await page.waitForSelector(imageSelector, { timeout: 60_000 }).catch(() => {
    console.warn(
      'Main reader content may not have loaded, continuing anyway...'
    )
  })
}

async function resetToInitialPage(
  page: Page,
  initialPageNav: PageNav | undefined
): Promise<void> {
  if (initialPageNav?.page === undefined) return

  console.warn(`resetting back to initial page ${initialPageNav.page}...`)
  await goToPage(page, initialPageNav.page)
}

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
  const {
    authUserDataDir,
    bookDir,
    pageScreenshotsDir,
    metadataPath,
    donePath,
    result
  } = await prepareExtractRun({ outDir, asin })

  const krRendererMainImageSelector = '#kr-renderer .kg-full-page-img img',
    bookReaderUrl = `https://read.amazon.com/?asin=${asin}`

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

    const pendingToc = createPendingTocTracker(result)

    const capturedBlobs = await setupReaderSession({
      page,
      context,
      asin,
      bookDir,
      result,
      bookReaderUrl,
      headless,
      renderMethod,
      onRawToc: pendingToc.setRawToc
    })

    await ensureReaderUiReady(page)
    await waitForReaderContent(page, krRendererMainImageSelector)

    // Record the initial page navigation so we can reset back to it later
    const initialPageNav = await getPageNav(page)

    assert(
      result.toc?.length,
      `expected book toc to be initialized (raw toc seen: ${pendingToc.hasPendingRawToc()}, location map seen: ${!!result.locationMap}) — try re-running, Amazon sometimes skips the toc render on the first visit after a cold sign-in`
    )

    const pageNumberPaddingAmount = finalizeNavigationMetadata(result)
    await writeResultMetadata(metadataPath, result)

    // Navigate to the first content page of the book
    await goToPage(page, result.nav.startContentPage)
    await captureContentPages({
      page,
      result,
      pageScreenshotsDir,
      pageNumberPaddingAmount,
      maxPages,
      imageSelector: krRendererMainImageSelector,
      metadataPath,
      capturedBlobs,
      deviceScaleFactor,
      renderMethod
    })

    await writeResultMetadata(metadataPath, result)
    console.log()
    console.log(metadataPath)

    await resetToInitialPage(page, initialPageNav)

    // Signal to a concurrent transcribe (during `all` mode) that no more
    // pages are coming. Also acts as the idempotency marker for the CLI:
    // a future run with the same ASIN will skip extract if .done exists.
    await fs.writeFile(donePath, '')

    return asin
  } finally {
    await closeBrowserContext(context)
  }
}
