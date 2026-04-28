import { defineCommand, runMain } from 'citty'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  DEFAULT_OCR_ENGINE,
  MLX_DEFAULTS,
  OCR_ENGINES,
  OLLAMA_DEFAULTS,
  parseFormat,
  pipelineArgsFromCli,
  runPipeline,
  STAGE_ORDER
} from './cli-pipeline'
import { parsePositiveInt } from './cli-utils'
import {
  DEFAULT_COMPARE_ENGINES,
  DEFAULT_COMPARE_PAGES,
  DEFAULT_COMPARE_TIMEOUT_MS,
  runCompare
} from './compare-ocr-backends'
import { fileExists } from './utils'

const require = createRequire(import.meta.url)
const VERSION = (require('../package.json') as { version: string }).version

const runCmd = defineCommand({
  meta: {
    name: 'run',
    description:
      'Full pipeline: pick a book (if --asin omitted), capture pages, OCR, assemble + clean + export Markdown.'
  },
  args: {
    asin: {
      type: 'string',
      description:
        'Kindle ASIN. Omit to pick a book in a visible Chrome window.'
    },
    'out-dir': {
      type: 'string',
      default: './out',
      description: 'Where outputs go (per-book subdirectory inside).'
    },
    engine: {
      type: 'string',
      default: DEFAULT_OCR_ENGINE,
      description: `OCR engine (${OCR_ENGINES.join(' | ')}).`
    },
    model: {
      type: 'string',
      description:
        'OCR model override. Defaults: ollama → glm-ocr; mlx → mlx-community/PaddleOCR-VL-1.5-bf16.'
    },
    format: {
      type: 'string',
      default: 'plain',
      description: 'Output format: "plain" (verbatim) or "markdown".'
    },
    'max-pages': {
      type: 'string',
      description: 'Cap the number of pages extracted + transcribed.'
    },
    headless: {
      type: 'boolean',
      default: true,
      description:
        'Run the page-capture browser headless (after the picker). Pass --no-headless to see Chrome flip pages.'
    },
    force: {
      type: 'boolean',
      default: false,
      description: 'Redo every stage, even if outputs exist.'
    },
    'force-from': {
      type: 'string',
      description: `Redo from this stage onward (${STAGE_ORDER.join(' | ')}).`
    },
    'ollama-url': {
      type: 'string',
      description: `Ollama server URL. Default: ${OLLAMA_DEFAULTS.baseUrl}.`
    },
    'mlx-url': {
      type: 'string',
      description: `MLX-VLM server URL. Default: ${MLX_DEFAULTS.baseUrl}.`
    },
    prompt: {
      type: 'string',
      description:
        'Full-override of the OCR prompt. Skips the plain/markdown selection.'
    },
    'allow-partial': {
      type: 'boolean',
      default: false,
      description:
        'Write content.json even when some OCR pages fail. By default partial exports abort.'
    }
  },
  async run({ args }) {
    await runPipeline(pipelineArgsFromCli(args))
  }
})

const compareCmd = defineCommand({
  meta: {
    name: 'compare',
    description:
      'Run multiple OCR backends side-by-side on the first N pages of an already-extracted book.'
  },
  args: {
    asin: { type: 'string', required: true, description: 'Kindle ASIN.' },
    'out-dir': { type: 'string', default: './out' },
    engines: {
      type: 'string',
      default: DEFAULT_COMPARE_ENGINES,
      description:
        'Comma-separated engines, each `engine` or `engine:model`. Example: ollama:glm-ocr,mlx.'
    },
    format: {
      type: 'string',
      default: 'plain',
      description: 'OCR output format: "plain" or "markdown".'
    },
    'max-pages': {
      type: 'string',
      default: String(DEFAULT_COMPARE_PAGES),
      description: 'Number of pages to compare across.'
    },
    'timeout-ms': {
      type: 'string',
      default: String(DEFAULT_COMPARE_TIMEOUT_MS),
      description: 'Per-request timeout in ms.'
    }
  },
  async run({ args }) {
    const bookDir = path.join(args['out-dir'], args.asin)
    if (!(await fileExists(path.join(bookDir, 'metadata.json')))) {
      throw new Error(
        `no metadata at ${bookDir}/metadata.json — run \`antigraph\` (without compare) on this book first`
      )
    }

    await fs.mkdir(bookDir, { recursive: true })

    const options: Parameters<typeof runCompare>[0] = {
      asin: args.asin,
      outDir: args['out-dir'],
      engines: args.engines,
      format: parseFormat(args.format)
    }
    const maxPages = parsePositiveInt(args['max-pages'], '--max-pages')
    const timeoutMs = parsePositiveInt(args['timeout-ms'], '--timeout-ms')
    if (maxPages !== undefined) options.maxPages = maxPages
    if (timeoutMs !== undefined) options.timeoutMs = timeoutMs

    await runCompare(options)
  }
})

export const main = defineCommand({
  meta: {
    name: 'antigraph',
    version: VERSION,
    description:
      'OCR-based pipeline that turns Kindle books you own into clean, chapter-scoped Markdown.'
  },
  args: runCmd.args!,
  subCommands: {
    run: runCmd,
    compare: compareCmd
  },
  run: runCmd.run!
})

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runMain(main)
}
