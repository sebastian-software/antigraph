import type { Locator, Page } from 'patchright'

import { setTimeout as delay } from 'node:timers/promises'
import pRace from 'p-race'

import type { PageNav } from './types'

import { parsePageNav } from './playwright-utils'

export async function ensureReaderUiReady(page: Page): Promise<void> {
  await dismissPossibleAlert(page)
  await ensureFixedHeaderUI(page)
  await updateSettings(page)
}

export async function goToPage(page: Page, pageNumber: number): Promise<void> {
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
  await page
    .locator('ion-modal ion-button[item-i-d="go-to-modal-go-button"]')
    .click()
  await delay(500)
}

export async function getPageNav(page: Page): Promise<PageNav | undefined> {
  const footerText = await page
    .locator('ion-footer ion-title')
    .first()
    .textContent()
  return parsePageNav(footerText)
}

interface AdvanceToNextPageOptions {
  page: Page
  imageSelector: string
  src: string
  pageNav: PageNav
}

export async function advanceToNextPage({
  page,
  imageSelector,
  src,
  pageNav
}: AdvanceToNextPageOptions): Promise<boolean> {
  let retries = 0

  for (;;) {
    await delay(100)

    let navigationTimeout = 10_000
    try {
      await page.locator('.kr-chevron-container-right').click({ timeout: 5000 })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn('unable to click next page button', message, pageNav)
      navigationTimeout = 1000
    }

    const navigatedToNextPage = await pRace<boolean | undefined>((signal) => [
      (async () => {
        while (!signal.aborted) {
          const newSrc = await page.locator(imageSelector).getAttribute('src')

          if (newSrc !== null && newSrc !== '' && newSrc !== src) {
            return true
          }

          await delay(10)
        }

        return false
      })(),

      delay(navigationTimeout, undefined, { signal })
    ])

    if (navigatedToNextPage === true) return true

    if (++retries >= 30) {
      console.warn('unable to navigate to next page; breaking...', pageNav)
      return false
    }
  }
}

export async function ensureSignedIntoBook(
  page: Page,
  bookReaderUrl: string,
  headless: boolean
): Promise<void> {
  if (!new URL(page.url()).pathname.includes('/ap/signin')) {
    return
  }

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

/**
 * Force one known display font so the render server delivers the whole book in
 * a single font the glyph matcher is calibrated against. Bookerly (a serif) is
 * chosen because its crisp, feature-rich letterforms separate cleanly at the
 * pixel level — OpenDyslexic, despite being open-licensed, is optimized for
 * human reading and its heavy rounded shapes are far harder to tell apart.
 */
const READER_FONT_SELECTOR = '#Bookerly'

async function updateSettings(page: Page): Promise<void> {
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

  // Force OpenDyslexic so the render server delivers the book in a single,
  // known font whose letterforms are maximally distinct (b/d/p/q, I/l/1) — the
  // reference the glyph matcher works against. The "Most Recent Page Read" sync
  // dialog can appear asynchronously while the panel is open, so dismiss
  // reactively around each click rather than once up front.
  console.log('Changing font to Bookerly')
  await clickPastAlerts(page, page.locator(READER_FONT_SELECTOR))
  await delay(200)

  console.log('Changing to single column layout')
  await clickPastAlerts(
    page,
    page.locator('[role="radiogroup"][aria-label$=" columns"]', {
      hasText: 'Single Column'
    })
  )
  await delay(200)

  console.log('Closing settings')
  await settingsButton.click()
  await delay(500)
}

async function ensureFixedHeaderUI(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      .top-chrome {
        transition: none !important;
        transform: none !important;
      }
    `
  })
}

const ALERT_DECLINE_LABELS = ['No', 'Cancel', 'Not Now', 'Dismiss', 'Stay']
const CLICK_PAST_ALERTS_TIMEOUT_MS = 30_000

async function clickQuietly(locator: Locator): Promise<void> {
  try {
    await locator.click({ timeout: 2000 })
  } catch {
    // Best-effort; ignore a lost race with the overlay closing.
  }
}

/**
 * Dismiss any blocking `ion-alert` the reader surfaces — a consent prompt, or
 * the "Most Recent Page Read" sync dialog that offers to jump to a newer
 * position. Left open, these overlays intercept later clicks.
 */
async function dismissPossibleAlert(page: Page): Promise<void> {
  for (const label of ALERT_DECLINE_LABELS) {
    const button = page.locator('ion-alert button', { hasText: label }).first()
    if (await button.isVisible().catch(() => false)) {
      await clickQuietly(button)
      await delay(200)
      return
    }
  }

  // The "Most Recent Page Read" sync prompt uses app-specific button labels;
  // either choice is safe (extract navigates to the content start afterwards),
  // so clear it by clicking its first button.
  const syncAlert = page
    .locator('ion-alert:has-text("Most Recent Page Read")')
    .first()
  if (await syncAlert.isVisible().catch(() => false)) {
    await clickQuietly(syncAlert.locator('button').first())
    await delay(200)
    return
  }

  if (
    await page
      .locator('ion-alert')
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    try {
      await page.keyboard.press('Escape')
    } catch {
      // Best-effort dismissal.
    }
    await delay(200)
  }
}

/**
 * Click `locator`, dismissing any `ion-alert` that appears — the sync dialog
 * can pop up mid-interaction, so we dismiss and retry rather than waiting out a
 * single click's full timeout.
 */
async function clickPastAlerts(page: Page, locator: Locator): Promise<void> {
  const deadline = Date.now() + CLICK_PAST_ALERTS_TIMEOUT_MS
  for (;;) {
    await dismissPossibleAlert(page)
    try {
      await locator.click({ timeout: 2500 })
      return
    } catch (error) {
      if (Date.now() >= deadline) throw error
      await delay(300)
    }
  }
}
