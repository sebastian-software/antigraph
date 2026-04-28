import type { Page } from 'patchright'

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

  while (true) {
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

          if (newSrc && newSrc !== src) {
            return true
          }

          await delay(10)
        }

        return false
      })(),

      delay(navigationTimeout, undefined, { signal })
    ])

    if (navigatedToNextPage) return true

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

  console.log('Changing font to Amazon Ember')
  await page.locator('#AmazonEmber').click()
  await delay(200)

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

async function dismissPossibleAlert(page: Page): Promise<void> {
  const alertNo = page.locator('ion-alert button', { hasText: 'No' })
  if (await alertNo.isVisible()) {
    await alertNo.click()
  }
}
