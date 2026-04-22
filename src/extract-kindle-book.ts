import fs from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import pRace from 'p-race'
import { chromium } from 'patchright'
import sharp from 'sharp'

import type {
  AmazonRenderLocationMap,
  AmazonRenderToc,
  AmazonRenderTocItem,
  BookMetadata,
  TocItem
} from './types'
import { parsePageNav, parseTocItems } from './playwright-utils'
import {
  assert,
  extractTar,
  hashObject,
  normalizeAuthors,
  normalizeBookMetadata,
  parseJsonpResponse,
  parsePageLabel,
  tryReadJsonFile
} from './utils'

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

// Block amazon analytics requests
// (not strictly necessary, but adblockers do this by default anyway and it
// makes the script run a bit faster)
const urlRegexBlacklist = [
  /unagi-\w+\.amazon\.com/i, // 'unagi-na.amazon.com'
  /m\.media-amazon\.com.*\/showads/i,
  /fls-na\.amazon\.com.*\/remote-weblab-triggers/i
]

type RENDER_METHOD = 'screenshot' | 'blob'
const renderMethod: RENDER_METHOD = 'blob'

type BrowserContext = Awaited<
  ReturnType<typeof chromium.launchPersistentContext>
>

interface CapturedBlob {
  type: string
  base64: string
}

type ExtractMetadataDraft = Partial<BookMetadata> &
  Pick<BookMetadata, 'pages' | 'nav'>

async function closeBrowserContext(context: BrowserContext): Promise<void> {
  const browser = context.browser()
  await context.close().catch((error: unknown) => {
    console.warn('warning: failed to close browser context:', error)
  })
  await browser?.close().catch((error: unknown) => {
    console.warn('warning: failed to close browser:', error)
  })
}

/**
 * Shared Chrome profile path. Keeping sign-in in one directory means
 * passkey / OTP / 2FA only happens once per machine; subsequent runs
 * land straight on the Kindle library.
 */
function authDataDir(outDir: string): string {
  return path.join(outDir, '.auth', 'data')
}

/**
 * Open the Kindle library in a real browser window and wait for the user to
 * click the book they want to export. Returns the ASIN parsed from the URL.
 *
 * Sign-in (including passkeys / 2FA) is handled manually in the browser —
 * we just wait for it to happen.
 */
async function pickAsin(outDir: string): Promise<string> {
  const authUserDataDir = authDataDir(outDir)
  await fs.mkdir(authUserDataDir, { recursive: true })

  const context = await chromium.launchPersistentContext(authUserDataDir, {
    headless: false,
    channel: 'chrome',
    // Force English UI so the page-nav / Go-to-page selectors in the
    // reader ('Page X of Y', 'Go to Page') match regardless of the
    // Amazon account's language setting.
    locale: 'en-US',
    args: [
      '--hide-crash-restore-bubble',
      '--disable-features=PasswordAutosave',
      '--disable-features=WebAuthn',
      '--disable-features=MacAppCodeSignClone',
      '--lang=en-US'
    ],
    ignoreDefaultArgs: [
      '--enable-automation',
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled'
    ],
    bypassCSP: true,
    viewport: { width: 1280, height: 720 }
  })
  try {
    const page = context.pages()[0] ?? (await context.newPage())

    await page.goto('https://read.amazon.com/kindle-library', {
      waitUntil: 'domcontentloaded'
    })

    console.log(
      '→ Sign in if prompted, then click the book you want to export.'
    )
    console.log('  (Waiting up to 10 minutes; press Ctrl-C to abort.)\n')

    // Amazon navigates to `/?asin=XXX` when a book is opened from the library.
    await page.waitForURL(/[?&]asin=[a-z0-9]+/i, { timeout: 10 * 60 * 1000 })

    const asin = new URL(page.url()).searchParams.get('asin')
    assert(asin, 'Failed to capture ASIN from browser URL')

    console.log(`\n✓ Picked ASIN: ${asin}\n`)
    return asin
  } finally {
    await closeBrowserContext(context)
  }
}

/**
 * Run the page-capture stage. Returns the ASIN that was processed —
 * useful when the caller didn't know it up-front and a picker was used.
 */
export async function runExtract(options: ExtractOptions): Promise<string> {
  const { outDir, maxPages } = options
  const headless = options.headless ?? true
  const trimmedAsin = options.asin?.trim()
  const asin =
    trimmedAsin === undefined || trimmedAsin === ''
      ? await pickAsin(outDir)
      : trimmedAsin
  const asinL = asin.toLowerCase()

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

  const krRendererMainImageSelector = '#kr-renderer .kg-full-page-img img'
  const bookReaderUrl = `https://read.amazon.com/?asin=${asin}`

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
  const context = await chromium.launchPersistentContext(authUserDataDir, {
    headless,
    channel: 'chrome',
    // Force English UI so the reader's page-nav ("Page X of Y") and
    // "Go to Page" menu match the selectors below regardless of what
    // language the Amazon account is set to.
    locale: 'en-US',
    args: [
      // hide chrome's crash restore popup
      '--hide-crash-restore-bubble',
      // disable chrome's password autosave popups
      '--disable-features=PasswordAutosave',
      // disable chrome's passkey popups
      '--disable-features=WebAuthn',
      // disable chrome creating 1GB temp directories on each run
      '--disable-features=MacAppCodeSignClone',
      // match the context locale so the reader shell renders in English
      '--lang=en-US'
    ],
    ignoreDefaultArgs: [
      // disable chrome's default automation detection flag
      '--enable-automation',
      // adding this cause chrome shows a weird admin popup without it
      '--no-sandbox',
      // adding this cause chrome shows a weird admin popup without it
      '--disable-blink-features=AutomationControlled'
    ],
    // bypass amazon's default content security policy which allows us to inject
    // our own scripts into the page
    bypassCSP: true,
    deviceScaleFactor,
    viewport: { width: 1280, height: 720 }
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

    await page.route('**/*', async (route) => {
      const urlString = route.request().url()
      for (const regex of urlRegexBlacklist) {
        if (regex.test(urlString)) {
          return route.abort()
        }
      }

      return route.continue()
    })

    page.on('response', async (response) => {
      try {
        const status = response.status()
        if (status !== 200) {
          return
        }

        const url = new URL(response.url())
        if (url.pathname.endsWith('YJmetadata.jsonp')) {
          const body = await response.text()
          const metadata = parseJsonpResponse<any>(body)
          if (metadata.asin !== asin) return

          delete metadata.cpr
          if (Array.isArray(metadata.authorsList)) {
            metadata.authorsList = normalizeAuthors(metadata.authorsList)
          }

          if (!result.meta) {
            console.warn('book meta', metadata)
            result.meta = metadata
          }
        } else if (
          url.hostname === 'read.amazon.com' &&
          url.searchParams.get('asin')?.toLowerCase() === asinL
        ) {
          if (url.pathname === '/service/mobile/reader/startReading') {
            const body: any = await response.json()
            delete body.karamelToken
            delete body.metadataUrl
            delete body.YJFormatVersion
            if (!result.info) {
              console.warn('book info', body)
            }
            result.info = body
          } else if (url.pathname === '/renderer/render') {
            // TODO: these TAR files have some useful metadata that we could use...
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

            const locationMap = await tryReadJsonFile<AmazonRenderLocationMap>(
              path.join(renderDir, 'location_map.json')
            )
            if (locationMap) {
              // Labels are mostly Arabic ("42") but Kindle uses Roman
              // numerals for front-matter pages ("iv"), so parse both and
              // drop entries whose label is neither rather than aborting
              // the whole response handler on a single odd row.
              locationMap.navigationUnit = locationMap.navigationUnit.flatMap(
                (navUnit) => {
                  const parsedPage = parsePageLabel(navUnit.label)
                  if (Number.isNaN(parsedPage)) {
                    console.warn(
                      `locationMap: dropping entry with unparseable label "${navUnit.label}"`
                    )
                    return []
                  }
                  return [{ ...navUnit, page: parsedPage }]
                }
              )
              result.locationMap = locationMap
            }

            const metadata = await tryReadJsonFile<any>(
              path.join(renderDir, 'metadata.json')
            )
            if (metadata) {
              result.nav.startPosition = metadata.firstPositionId
              result.nav.endPosition = metadata.lastPositionId
            }

            const rawToc = await tryReadJsonFile<AmazonRenderToc>(
              path.join(renderDir, 'toc.json')
            )
            if (rawToc && !result.toc) {
              pendingRawToc = rawToc
            }
            tryFinalizeToc()

            // TODO: `page_data_0_5.json` has start/end/words for each page in this render batch
            // const toc = JSON.parse(
            //   await fs.readFile(path.join(tempDir, 'toc.json'), 'utf8')
            // )
            // console.warn('toc', toc)
          }
        }
      } catch (error) {
        // Response handlers run off the main flow; log so we notice when a
        // parse failure silently drops a TAR's metadata rather than debug a
        // missing TOC from scratch later.
        console.warn('response handler error:', error)
      }
    })

    // Only used for the 'blob' render method
    const capturedBlobs = new Map<string, CapturedBlob>()

    if (renderMethod === 'blob') {
      await page.exposeFunction('nodeLog', (...args: any[]) => {
        console.error('[page]', ...args)
      })

      await page.exposeBinding('captureBlob', (_source, url, payload) => {
        capturedBlobs.set(url, payload)
      })

      await context.addInitScript(() => {
        const origCreateObjectURL = URL.createObjectURL.bind(URL)
        URL.createObjectURL = function (blob: Blob) {
          // TODO: filter for image/png blobs? since those are the only ones we're using
          // (haven't found this to be an issue in practice)
          const type = blob.type || 'application/octet-stream'
          const url = origCreateObjectURL(blob)
          // nodeLog('createObjectURL', url, type, blob.size)

          // Snapshot blob bytes immediately because kindle's renderer revokes
          // them immediately after they're used.
          void (async () => {
            const buf = await blob.arrayBuffer()
            // store raw base64 (not data URL) to keep payload small
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
    }

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
    if (/\/ap\/signin/g.test(new URL(page.url()).pathname)) {
      if (headless) {
        throw new Error(
          'Kindle session expired and headless extraction cannot prompt for login. ' +
            'Re-run without ASIN (`pnpm extract`) to sign in, then retry, ' +
            'or set EXTRACT_HEADLESS=false to sign in in a visible window.'
        )
      }
      console.log('→ Please sign in in the browser window.')
      await page.waitForURL(
        (url) => !new URL(url).pathname.includes('/ap/signin'),
        { timeout: 10 * 60 * 1000 }
      )
      if (!page.url().includes(bookReaderUrl)) {
        await page.goto(bookReaderUrl)
      }
    }

    async function updateSettings() {
      console.log('Looking for Reader settings button')
      const settingsButton = page
        .locator(
          'ion-button[aria-label="Reader settings"], ' +
            'button[aria-label="Reader settings"]'
        )
        .first()
      await settingsButton.waitFor({ timeout: 30_000 })
      console.log('Clicking Reader settings')
      await settingsButton.click()
      await delay(500)

      // Change font to Amazon Ember
      // My hypothesis is that this font will be easier for OCR to transcribe...
      // TODO: evaluate different fonts & settings
      console.log('Changing font to Amazon Ember')
      await page.locator('#AmazonEmber').click()
      await delay(200)

      // Change layout to single column
      console.log('Changing to single column layout')
      await page
        .locator('[role="radiogroup"][aria-label$=" columns"]', {
          hasText: 'Single Column'
        })
        .click()
      await delay(200)

      console.log('Closing settings')
      await settingsButton.click()
      await delay(500)
    }

    async function goToPage(pageNumber: number) {
      await page.locator('#reader-header').hover({ force: true })
      await delay(200)
      await page.locator('ion-button[aria-label="Reader menu"]').click()
      await delay(500)
      await page
        .locator('ion-item[role="listitem"]', { hasText: 'Go to Page' })
        .click()
      await page
        .locator('ion-modal input[placeholder="page number"]')
        .fill(`${pageNumber}`)
      // await page.locator('ion-modal button', { hasText: 'Go' }).click()
      await page
        .locator('ion-modal ion-button[item-i-d="go-to-modal-go-button"]')
        .click()
      await delay(500)
    }

    async function getPageNav() {
      const footerText = await page
        .locator('ion-footer ion-title')
        .first()
        .textContent()
      return parsePageNav(footerText)
    }

    async function ensureFixedHeaderUI() {
      await page.locator('.top-chrome').evaluate((el) => {
        el.style.transition = 'none'
        el.style.transform = 'none'
      })
    }

    async function dismissPossibleAlert() {
      const $alertNo = page.locator('ion-alert button', { hasText: 'No' })
      if (await $alertNo.isVisible()) {
        await $alertNo.click()
      }
    }

    async function writeResultMetadata() {
      return fs.writeFile(
        metadataPath,
        JSON.stringify(normalizeBookMetadata(result), null, 2)
      )
    }

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

    await dismissPossibleAlert()
    await ensureFixedHeaderUI()
    await updateSettings()

    console.log('Waiting for book reader to load...')
    await page
      .waitForSelector(krRendererMainImageSelector, { timeout: 60_000 })
      .catch(() => {
        console.warn(
          'Main reader content may not have loaded, continuing anyway...'
        )
      })

    // Record the initial page navigation so we can reset back to it later
    const initialPageNav = await getPageNav()

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
    await writeResultMetadata()

    // Navigate to the first content page of the book
    await goToPage(result.nav.startContentPage)

    let done = false
    console.warn(
      `\nreading ${result.nav.totalNumContentPages} content pages out of ${result.nav.totalNumPages} total pages...\n`
    )

    // Loop through each page of the book
    do {
      const pageNav = await getPageNav()

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
      await writeResultMetadata()

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

      let retries = 0

      while (!done) {
        // This delay seems to help speed up the navigation process, possibly due
        // to the navigation chevron needing time to settle.
        await delay(100)

        let navigationTimeout = 10_000
        try {
          // await page.keyboard.press('ArrowRight')
          await page
            .locator('.kr-chevron-container-right')
            .click({ timeout: 5000 })
        } catch (error: any) {
          console.warn(
            'unable to click next page button',
            error.message,
            pageNav
          )
          navigationTimeout = 1000
        }

        const navigatedToNextPage = await pRace<boolean | undefined>(
          (signal) => [
            (async () => {
              while (!signal.aborted) {
                const newSrc = await page
                  .locator(krRendererMainImageSelector)
                  .getAttribute('src')

                if (newSrc && newSrc !== src) {
                  // Successfully navigated to the next page
                  return true
                }

                await delay(10)
              }

              return false
            })(),

            delay(navigationTimeout, undefined, { signal })
          ]
        )

        if (navigatedToNextPage) {
          break
        }

        if (++retries >= 30) {
          console.warn('unable to navigate to next page; breaking...', pageNav)
          done = true
          break
        }
      }
    } while (!done)

    await writeResultMetadata()
    console.log()
    console.log(metadataPath)

    if (initialPageNav?.page !== undefined) {
      console.warn(`resetting back to initial page ${initialPageNav.page}...`)
      // Reset back to the initial page
      await goToPage(initialPageNav.page)
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
