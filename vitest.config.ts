import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/assemble-chapters.ts',
        'src/chapter-cleanup.ts',
        'src/cli-utils.ts',
        'src/export-book-markdown.ts',
        'src/playwright-utils.ts',
        'src/transcribe-book-content.ts',
        'src/utils.ts',
        'src/ocr/index.ts'
      ],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70
      }
    }
  }
})
