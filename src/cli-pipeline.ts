import path from 'node:path'

import { runAssemble } from './assemble-chapters'
import { runCleanup } from './cleanup-chapters'
import { formatCliValue, parsePositiveInt } from './cli-utils'
import { runExport } from './export-book-markdown'
import { runExtract } from './extract-kindle-book'
import {
  DEFAULT_OCR_ENGINE,
  MLX_DEFAULTS,
  OCR_ENGINES,
  type OcrBackendOptions,
  type OcrEngine,
  OLLAMA_DEFAULTS
} from './ocr'
import { runGlyphTranscribe } from './transcribe-glyphs'
import { fileExists, readJsonFile } from './utils'

const CONTENT_STAGE_COUNT_MATCHES = 'content.json entry count matches pages'

export type PipelineStage =
  'assemble' | 'cleanup' | 'export' | 'extract' | 'transcribe'

export const STAGE_ORDER: PipelineStage[] = [
  'extract',
  'transcribe',
  'assemble',
  'cleanup',
  'export'
]

export interface PipelineArgs {
  asin?: string
  outDir: string
  engine: OcrEngine
  model?: string
  maxPages?: number
  headless: boolean
  force: boolean
  forceFrom?: PipelineStage
  ollamaUrl?: string
  mlxUrl?: string
}

export function parseEngine(raw: unknown): OcrEngine {
  if (typeof raw !== 'string' || !OCR_ENGINES.includes(raw as OcrEngine)) {
    throw new TypeError(
      `--engine must be one of: ${OCR_ENGINES.join(', ')} (got "${formatCliValue(raw)}")`
    )
  }
  return raw as OcrEngine
}

function parseOptionalString(raw: unknown, flag: string): string | undefined {
  if (raw === undefined || raw === '') return undefined
  if (typeof raw !== 'string') {
    throw new TypeError(
      `${flag} must be a string (got "${formatCliValue(raw)}")`
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

async function extractIsDone(outDir: string, asin: string): Promise<boolean> {
  const bookDir = path.join(outDir, asin)
  const [doneOk, metaOk] = await Promise.all([
    fileExists(path.join(bookDir, '.done')),
    fileExists(path.join(bookDir, 'metadata.json'))
  ])
  return doneOk && metaOk
}

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

function backendOptions(args: PipelineArgs): OcrBackendOptions {
  const options: OcrBackendOptions = {
    baseUrl:
      args.engine === 'ollama'
        ? (args.ollamaUrl ?? OLLAMA_DEFAULTS.baseUrl)
        : (args.mlxUrl ?? MLX_DEFAULTS.baseUrl)
  }
  if (args.model !== undefined && args.model !== '') options.model = args.model
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
  if (asin !== undefined && asin !== '') options.asin = asin
  if (args.maxPages !== undefined) options.maxPages = args.maxPages
  return options
}

function glyphTranscribeOptions(
  args: PipelineArgs,
  asin: string
): Parameters<typeof runGlyphTranscribe>[0] {
  const options: Parameters<typeof runGlyphTranscribe>[0] = {
    asin,
    outDir: args.outDir,
    engine: args.engine,
    backendOptions: backendOptions(args)
  }
  if (args.maxPages !== undefined) options.maxPages = args.maxPages
  return options
}

export function pipelineArgsFromCli(
  args: Record<string, unknown>
): PipelineArgs {
  const pipelineArgs: PipelineArgs = {
    outDir: args['out-dir'] as string,
    engine: parseEngine(args.engine),
    headless: args.headless as boolean,
    force: args.force as boolean
  }

  const asin = parseOptionalString(args.asin, 'asin')
  const model = parseOptionalString(args.model, '--model')
  const maxPages = parsePositiveInt(args['max-pages'], '--max-pages')
  const forceFromRaw = parseOptionalString(args['force-from'], '--force-from')
  const forceFrom =
    forceFromRaw === undefined ? undefined : parseStage(forceFromRaw)
  const ollamaUrl = parseOptionalString(args['ollama-url'], '--ollama-url')
  const mlxUrl = parseOptionalString(args['mlx-url'], '--mlx-url')

  if (asin !== undefined && asin !== '') pipelineArgs.asin = asin
  if (model !== undefined && model !== '') pipelineArgs.model = model
  if (maxPages !== undefined) pipelineArgs.maxPages = maxPages
  if (forceFrom !== undefined) pipelineArgs.forceFrom = forceFrom
  if (ollamaUrl !== undefined && ollamaUrl !== '') {
    pipelineArgs.ollamaUrl = ollamaUrl
  }
  if (mlxUrl !== undefined && mlxUrl !== '') pipelineArgs.mlxUrl = mlxUrl

  return pipelineArgs
}

function shouldSkip(
  stage: PipelineStage,
  forceFrom: PipelineStage | undefined,
  force: boolean
): boolean {
  if (force) return false
  if (forceFrom === undefined) return true
  return STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(forceFrom)
}

export async function runPipeline(args: PipelineArgs): Promise<void> {
  const forceFrom = args.force ? 'extract' : args.forceFrom

  let asin = args.asin?.trim()

  if (
    asin !== undefined &&
    asin !== '' &&
    shouldSkip('extract', forceFrom, false)
  ) {
    if (await extractIsDone(args.outDir, asin)) {
      console.log(`[extract] skipped (${asin}/.done present)`)
    } else {
      asin = await runExtract(extractOptions(args, asin))
    }
  } else {
    asin = await runExtract(extractOptions(args, asin))
  }

  const tx = await transcribeIsDone(args.outDir, asin)
  if (shouldSkip('transcribe', forceFrom, false) && tx.ok) {
    console.log(`[transcribe] skipped (${tx.reason})`)
  } else {
    await runGlyphTranscribe(glyphTranscribeOptions(args, asin))
  }

  await runAssemble({ asin, outDir: args.outDir })
  await runCleanup({ asin, outDir: args.outDir })
  await runExport({ asin, outDir: args.outDir })

  console.log(`\n✓ Done. Open ${path.join(args.outDir, asin, 'book.md')}`)
}

export { DEFAULT_OCR_ENGINE, MLX_DEFAULTS, OCR_ENGINES, OLLAMA_DEFAULTS }
