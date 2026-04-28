import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'patchright'

import { assert } from './utils'

export type KindleBrowserContext = Awaited<
  ReturnType<typeof chromium.launchPersistentContext>
>

interface LaunchKindleContextOptions {
  headless: boolean
  deviceScaleFactor?: number
}

export async function closeBrowserContext(
  context: KindleBrowserContext
): Promise<void> {
  const browser = context.browser()
  await context.close().catch((error: unknown) => {
    console.warn('warning: failed to close browser context:', error)
  })
  await browser?.close().catch((error: unknown) => {
    console.warn('warning: failed to close browser:', error)
  })
}

export function authDataDir(outDir: string): string {
  return path.join(outDir, '.auth', 'data')
}

export async function launchKindleContext(
  userDataDir: string,
  { headless, deviceScaleFactor }: LaunchKindleContextOptions
): Promise<KindleBrowserContext> {
  const options: Parameters<typeof chromium.launchPersistentContext>[1] = {
    headless,
    channel: 'chrome',
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
  }
  if (deviceScaleFactor !== undefined) {
    options.deviceScaleFactor = deviceScaleFactor
  }
  return chromium.launchPersistentContext(userDataDir, options)
}

export async function pickAsin(outDir: string): Promise<string> {
  const userDataDir = authDataDir(outDir)
  await fs.mkdir(userDataDir, { recursive: true })

  const context = await launchKindleContext(userDataDir, { headless: false })
  try {
    const page = context.pages()[0] ?? (await context.newPage())

    await page.goto('https://read.amazon.com/kindle-library', {
      waitUntil: 'domcontentloaded'
    })

    console.log(
      '→ Sign in if prompted, then click the book you want to export.'
    )
    console.log('  (Waiting up to 10 minutes; press Ctrl-C to abort.)\n')

    await page.waitForURL(/[?&]asin=[a-z0-9]+/i, { timeout: 10 * 60 * 1000 })

    const asin = new URL(page.url()).searchParams.get('asin')
    assert(asin, 'Failed to capture ASIN from browser URL')

    console.log(`\n✓ Picked ASIN: ${asin}\n`)
    return asin
  } finally {
    await closeBrowserContext(context)
  }
}
