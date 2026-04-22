import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import { runExtract } from './extract-kindle-book'

const mocks = vi.hoisted(() => ({
  launchPersistentContext: vi.fn()
}))

vi.mock('patchright', () => ({
  chromium: {
    launchPersistentContext: mocks.launchPersistentContext
  }
}))

describe('runExtract', () => {
  test('closes the browser context when extraction fails before completion', async () => {
    const outDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'antigraph-extract-')
    )
    const browser = { close: vi.fn().mockResolvedValue(undefined) }
    const context = {
      browser: vi.fn(() => browser),
      close: vi.fn().mockResolvedValue(undefined),
      pages: vi.fn(() => [
        {
          route: vi.fn().mockRejectedValue(new Error('route failed'))
        }
      ]),
      newPage: vi.fn()
    }
    mocks.launchPersistentContext.mockResolvedValue(context)

    await expect(
      runExtract({ asin: 'TESTASIN', outDir, headless: true })
    ).rejects.toThrow('route failed')

    expect(context.close).toHaveBeenCalledOnce()
    expect(browser.close).toHaveBeenCalledOnce()
    await expect(
      fs.access(path.join(outDir, 'TESTASIN', '.done'))
    ).rejects.toThrow()
  })
})
