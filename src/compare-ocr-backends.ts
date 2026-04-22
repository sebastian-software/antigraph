import fs from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import type { BookMetadata, PageChunk } from './types'
import { createOcrBackend, type OcrBackend, type OcrFormat } from './ocr'
import { assert, fileExists, readJsonFile } from './utils'

export const DEFAULT_COMPARE_ENGINES = 'ollama:glm-ocr,mlx'
export const DEFAULT_COMPARE_PAGES = 3
export const DEFAULT_COMPARE_TIMEOUT_MS = 120_000

export interface CompareOptions {
  asin: string
  outDir: string
  engines?: string
  format?: OcrFormat
  maxPages?: number
  timeoutMs?: number
}

interface BackendOutput {
  engine: string
  backendName: string
  text: string
  chars: number
  durationMs: number
  error?: string
}

interface PageComparison {
  index: number
  page: number
  screenshot: string
  outputs: BackendOutput[]
}

interface EngineSummary {
  engine: string
  backendName: string
  totalMs: number
  avgMs: number
  totalChars: number
  failures: number
}

interface EngineSpec {
  /** Full spec as written, used as the column label in reports. */
  label: string
  engine: string
  model?: string
}

function parseEngines(raw: string | undefined): EngineSpec[] {
  const specs = (raw ?? DEFAULT_COMPARE_ENGINES)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  assert(specs.length > 0, 'engines list is empty')

  // An entry may be a bare engine name ("ollama") or
  // "engine:model" ("ollama:qwen3-vl"). The second form overrides the
  // engine's default model for this run only — lets us compare multiple
  // Ollama model variants in the same compare run without juggling envs.
  return specs.map((spec): EngineSpec => {
    const colon = spec.indexOf(':')
    if (colon === -1) return { label: spec, engine: spec }
    return {
      label: spec,
      engine: spec.slice(0, colon),
      model: spec.slice(colon + 1)
    }
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${(timeoutMs / 1000).toFixed(0)}s`))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })
}

async function runOnePage(
  pageChunk: PageChunk,
  backends: Array<{ label: string; backend: OcrBackend }>,
  format: OcrFormat,
  timeoutMs: number
): Promise<PageComparison> {
  const imageBuffer = await fs.readFile(pageChunk.screenshot)

  async function runOne({
    label,
    backend
  }: {
    label: string
    backend: OcrBackend
  }): Promise<BackendOutput> {
    const start = performance.now()
    try {
      const text = await withTimeout(
        backend.transcribe({
          imageBuffer,
          mimeType: 'image/webp',
          index: pageChunk.index,
          screenshot: pageChunk.screenshot,
          format
        }),
        timeoutMs
      )
      const durationMs = performance.now() - start
      return {
        engine: label,
        backendName: backend.name,
        text,
        chars: text.length,
        durationMs
      }
    } catch (error) {
      const durationMs = performance.now() - start
      const message = error instanceof Error ? error.message : String(error)
      return {
        engine: label,
        backendName: backend.name,
        text: '',
        chars: 0,
        durationMs,
        error: message
      }
    }
  }

  // All backends are local (Ollama, MLX-VLM) and share one server process
  // plus unified memory. Running them in parallel on the same page causes
  // swap/thrashing and timeouts, so run them serially — each gets its turn
  // with the GPU to itself.
  const outputs: BackendOutput[] = []
  for (const b of backends) {
    outputs.push(await runOne(b))
  }

  return {
    index: pageChunk.index,
    page: pageChunk.page,
    screenshot: pageChunk.screenshot,
    outputs
  }
}

function summarise(
  comparisons: PageComparison[],
  engines: string[]
): EngineSummary[] {
  return engines.map((engine): EngineSummary => {
    const outputs = comparisons.flatMap((c) =>
      c.outputs.filter((o) => o.engine === engine)
    )
    const totalMs = outputs.reduce((acc, o) => acc + o.durationMs, 0)
    const totalChars = outputs.reduce((acc, o) => acc + o.chars, 0)
    const failures = outputs.filter((o) => o.error).length
    const backendName = outputs[0]?.backendName ?? engine
    return {
      engine,
      backendName,
      totalMs,
      avgMs: outputs.length === 0 ? 0 : totalMs / outputs.length,
      totalChars,
      failures
    }
  })
}

function renderMarkdown(
  asin: string,
  format: OcrFormat,
  comparisons: PageComparison[],
  summaries: EngineSummary[]
): string {
  const lines: string[] = [
    '# OCR Backend Comparison',
    '',
    `- Book: \`${asin}\``,
    `- Pages: ${comparisons.length}`,
    `- Format: \`${format}\``,
    `- Engines: ${summaries.map((s) => `\`${s.engine}\` (${s.backendName})`).join(', ')}`,
    '',
    '## Summary',
    '',
    '| Engine | Backend | Total ms | Avg ms/page | Total chars | Failures |',
    '|---|---|---:|---:|---:|---:|',
    ...summaries.map(
      (s) =>
        `| ${s.engine} | \`${s.backendName}\` | ${s.totalMs.toFixed(0)} | ${s.avgMs.toFixed(0)} | ${s.totalChars} | ${s.failures} |`
    ),
    ''
  ]

  for (const c of comparisons) {
    lines.push(
      `## Page index ${c.index} — book page ${c.page} — \`${path.basename(c.screenshot)}\``,
      ''
    )
    for (const o of c.outputs) {
      const header = o.error
        ? `### ${o.engine} — ${o.durationMs.toFixed(0)} ms — FAILED`
        : `### ${o.engine} — ${o.durationMs.toFixed(0)} ms — ${o.chars} chars`
      lines.push(header, '')
      if (o.error) {
        lines.push('```', o.error, '```', '')
      } else {
        lines.push('```', o.text, '```', '')
      }
    }
    lines.push('---', '')
  }

  return lines.join('\n')
}

function renderSummaryTable(summaries: EngineSummary[]): string {
  const rows = [
    ['Engine', 'Backend', 'Total ms', 'Avg ms/page', 'Chars', 'Fails'],
    ...summaries.map((s) => [
      s.engine,
      s.backendName,
      s.totalMs.toFixed(0),
      s.avgMs.toFixed(0),
      `${s.totalChars}`,
      `${s.failures}`
    ])
  ]
  const widths = rows[0]!.map((_, i) =>
    Math.max(...rows.map((row) => row[i]!.length))
  )
  return rows
    .map((row) => row.map((cell, i) => cell.padEnd(widths[i]!)).join('  '))
    .join('\n')
}

export async function runCompare(options: CompareOptions): Promise<void> {
  const { asin, outDir } = options
  const engines = parseEngines(options.engines)
  const maxPages = options.maxPages ?? DEFAULT_COMPARE_PAGES
  const format = options.format ?? 'plain'
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMPARE_TIMEOUT_MS

  const bookDir = path.join(outDir, asin)
  const metadataPath = path.join(bookDir, 'metadata.json')
  assert(
    await fileExists(metadataPath),
    `no metadata at ${metadataPath} — run extract first`
  )

  const metadata = await readJsonFile<BookMetadata>(metadataPath)
  assert(metadata.pages?.length, 'metadata has no pages')

  const pages = metadata.pages.slice(0, maxPages)
  console.log(
    `comparing ${engines.length} backend(s) on ${pages.length} page(s) of ${asin} (format: ${format})...`
  )

  // Construct defensively — a misconfigured backend (e.g. unreachable
  // Ollama / MLX server) shouldn't abort the whole comparison run.
  const backends: Array<{ label: string; backend: OcrBackend }> = []
  for (const spec of engines) {
    try {
      const backendOptions: Parameters<typeof createOcrBackend>[1] = {}
      if (spec.model) backendOptions.model = spec.model
      backends.push({
        label: spec.label,
        backend: createOcrBackend(spec.engine, backendOptions)
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.warn(`  ${spec.label} → skipped (init failed): ${msg}`)
    }
  }
  assert(backends.length > 0, 'no usable OCR backends after init')
  for (const { label, backend } of backends) {
    console.log(`  ${label} → ${backend.name}`)
  }

  const comparisons: PageComparison[] = []
  for (const pageChunk of pages) {
    const comparison = await runOnePage(pageChunk, backends, format, timeoutMs)
    comparisons.push(comparison)
    const summary = comparison.outputs
      .map(
        (o) =>
          `${o.engine}: ${o.durationMs.toFixed(0)}ms ${
            o.error ? 'FAILED' : `${o.chars}c`
          }`
      )
      .join(' | ')
    console.log(
      `  page ${pageChunk.page} (index ${pageChunk.index}): ${summary}`
    )
  }

  // Only summarise engines that actually ran — skipped ones would show up
  // as all-zero rows which is just noise.
  const activeLabels = backends.map((b) => b.label)
  const summaries = summarise(comparisons, activeLabels)

  const jsonPath = path.join(bookDir, 'compare.json')
  const markdownPath = path.join(bookDir, 'compare.md')

  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      { asin, format, engines: activeLabels, pages: comparisons, summaries },
      null,
      2
    )
  )
  await fs.writeFile(
    markdownPath,
    renderMarkdown(asin, format, comparisons, summaries)
  )

  console.log(`\n${renderSummaryTable(summaries)}`)
  console.log(`\nreport: ${markdownPath}`)
  console.log(`raw:    ${jsonPath}`)
}
