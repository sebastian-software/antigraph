#!/usr/bin/env node

import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { defineCommand, runMain } from 'citty'

import { runAssemble } from './assemble-chapters'
import { runCleanup } from './cleanup-chapters'
import { formatCliValue, parsePositiveInt } from './cli-utils'
import {
  DEFAULT_COMPARE_ENGINES,
  DEFAULT_COMPARE_PAGES,
  DEFAULT_COMPARE_TIMEOUT_MS,
  runCompare
} from './compare-ocr-backends'
import { runExport } from './export-book-markdown'
import { runExtract } from './extract-kindle-book'
import {
  DEFAULT_OCR_ENGINE,
  MLX_DEFAULTS,
  OCR_ENGINES,
  type OcrBackendOptions,
  type OcrEngine,
  type OcrFormat,
  OLLAMA_DEFAULTS
} from './ocr'
import { runTranscribe } from './transcribe-book-content'
import { fileExists, readJsonFile } from './utils'

const require = createRequire(import.meta.url)
const VERSION = (require('../package.json') as { version: string }).version

const CONTENT_STAGE_COUNT_MATCHES = 'content.json entry count matches pages'

type PipelineStage =
  | 'extract'
  | 'transcribe'
  | 'assemble'
  | 'cleanup'
  | 'export'

const STAGE_ORDER: PipelineStage[] = [
  'extract',
  'transcribe',
  'assemble',
  'cleanup',
  'export'
]

function parseEngine(raw: unknown): OcrEngine {
  if (typeof raw !== 'string' || !OCR_ENGINES.includes(raw as OcrEngine)) {
    throw new TypeError(
      `--engine must be one of: ${OCR_ENGINES.join(', ')} (got "${formatCliValue(raw)}")`
    )
  }
  return raw as OcrEngine
}

function parseFormat(raw: unknown): OcrFormat {
  if (raw === undefined || raw === '') return 'plain'
  if (raw !== 'plain' && raw !== 'markdown') {
    throw new TypeError(
      `--format must be "plain" or "markdown" (got "${formatCliValue(raw)}")`
    )
  }
  return raw
}

function parseStage(raw: unknown): PipelineStage {
  if (typeof raw !== 'string' || !STAGE_ORDER.includes(raw as PipelineStage)) {
    throw new TypeError(
      `--force-from must be one of: ${STAGE_ORDER.join(', ')}`
    )
  }
  return raw as PipelineStage
}

/**
 * Decide whether we can skip `extract` entirely. Skip when the `.done`
 * marker exists (extract finishes by writing it) AND a metadata.json is
 * present. No heuristic over page counts — we trust the marker.
 */
async function extractIsDone(outDir: string, asin: string): Promise<boolean> {
  const bookDir = path.join(outDir, asin)
  const [doneOk, metaOk] = await Promise.all([
    fileExists(path.join(bookDir, '.done')),
    fileExists(path.join(bookDir, 'metadata.json'))
  ])
  return doneOk && metaOk
}

/**
 * Decide whether we can skip `transcribe`. Skip when content.json
 * exists AND its entry count matches metadata.pages.length (i.e. the
 * previous run covered every captured page). Mismatch falls through
 * to a full re-run rather than a partial patch-up.
 */
async function transcribeIsDone(
  outDir: string,
  asin: string
): Promise<{ ok: boolean; reason?: string }> {
  const bookDir = path.join(outDir, asin)
  const contentPath = path.join(bookDir, 'content.json')
  const metadataPath = path.join(bookDir, 'metadata.json')
  if (!(await fileExists(contentPath))) return { ok: false }
  const [content, metadata] = await Promise.all([
    readJsonFile<unknown[]>(contentPath),
    readJsonFile<{ pages?: unknown[] }>(metadataPath)
  ])
  if (content.length !== (metadata.pages?.length ?? -1)) {
    return {
      ok: false,
      reason: `content.json has ${content.length} entries, metadata lists ${metadata.pages?.length ?? 0} pages`
    }
  }
  return { ok: true, reason: CONTENT_STAGE_COUNT_MATCHES }
}

interface PipelineArgs {
  asin?: string
  outDir: string
  engine: OcrEngine
  model?: string
  format: OcrFormat
  maxPages?: number
  headless: boolean
  force: boolean
  forceFrom?: PipelineStage
  ollamaUrl?: string
  mlxUrl?: string
  prompt?: string
  allowPartial: boolean
}

function backendOptions(args: PipelineArgs): OcrBackendOptions {
  const options: OcrBackendOptions = {
    baseUrl:
      args.engine === 'ollama'
        ? (args.ollamaUrl ?? OLLAMA_DEFAULTS.baseUrl)
        : (args.mlxUrl ?? MLX_DEFAULTS.baseUrl)
  }
  if (args.model) options.model = args.model
  if (args.prompt) options.prompt = args.prompt
  return options
}

function extractOptions(
  args: PipelineArgs,
  asin: string | undefined
): Parameters<typeof runExtract>[0] {
  const options: Parameters<typeof runExtract>[0] = {
    outDir: args.outDir,
    headless: args.headless
  }
  if (asin) options.asin = asin
  if (args.maxPages !== undefined) options.maxPages = args.maxPages
  return options
}

function transcribeOptions(
  args: PipelineArgs,
  asin: string
): Parameters<typeof runTranscribe>[0] {
  const options: Parameters<typeof runTranscribe>[0] = {
    asin,
    outDir: args.outDir,
    engine: args.engine,
    backendOptions: backendOptions(args),
    format: args.format,
    allowPartial: args.allowPartial
  }
  if (args.maxPages !== undefined) options.maxPages = args.maxPages
  return options
}

function pipelineArgsFromCli(args: Record<string, unknown>): PipelineArgs {
  const pipelineArgs: PipelineArgs = {
    outDir: args['out-dir'] as string,
    engine: parseEngine(args.engine),
    format: parseFormat(args.format),
    headless: args.headless as boolean,
    force: args.force as boolean,
    allowPartial: args['allow-partial'] as boolean
  }

  const asin = (args.asin as string | undefined) || undefined
  const model = (args.model as string | undefined) || undefined
  const maxPages = parsePositiveInt(args['max-pages'], '--max-pages')
  const forceFrom = args['force-from']
    ? parseStage(args['force-from'])
    : undefined
  const ollamaUrl = (args['ollama-url'] as string | undefined) || undefined
  const mlxUrl = (args['mlx-url'] as string | undefined) || undefined
  const prompt = (args.prompt as string | undefined) || undefined

  if (asin) pipelineArgs.asin = asin
  if (model) pipelineArgs.model = model
  if (maxPages !== undefined) pipelineArgs.maxPages = maxPages
  if (forceFrom) pipelineArgs.forceFrom = forceFrom
  if (ollamaUrl) pipelineArgs.ollamaUrl = ollamaUrl
  if (mlxUrl) pipelineArgs.mlxUrl = mlxUrl
  if (prompt) pipelineArgs.prompt = prompt

  return pipelineArgs
}

function shouldSkip(
  stage: PipelineStage,
  forceFrom: PipelineStage | undefined,
  force: boolean
): boolean {
  if (force) return false
  if (!forceFrom) return true
  return STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(forceFrom)
}

async function runPipeline(args: PipelineArgs): Promise<void> {
  const forceFrom = args.force ? 'extract' : args.forceFrom

  // Extract. If skipping, we still need to know the ASIN.
  let asin = args.asin?.trim()

  if (asin && shouldSkip('extract', forceFrom, false)) {
    if (await extractIsDone(args.outDir, asin)) {
      console.log(`[extract] skipped (${asin}/.done present)`)
    } else {
      asin = await runExtract(extractOptions(args, asin))
    }
  } else {
    asin = await runExtract(extractOptions(args, asin))
  }

  // Transcribe.
  const tx = await transcribeIsDone(args.outDir, asin)
  if (shouldSkip('transcribe', forceFrom, false) && tx.ok) {
    console.log(`[transcribe] skipped (${tx.reason})`)
  } else {
    await runTranscribe(transcribeOptions(args, asin))
  }

  // The last three always run — they're near-instant and avoiding the
  // "I changed cleanup.ts but the output didn't update" class of bug
  // is worth the one extra second.
  await runAssemble({ asin, outDir: args.outDir })
  await runCleanup({ asin, outDir: args.outDir })
  await runExport({ asin, outDir: args.outDir })

  console.log(`\n✓ Done. Open ${path.join(args.outDir, asin, 'book.md')}`)
}

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
