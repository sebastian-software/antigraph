import path from 'node:path'

export interface BackendOutput {
  engine: string
  backendName: string
  text: string
  chars: number
  durationMs: number
  error?: string
}

export interface PageComparison {
  index: number
  page: number
  screenshot: string
  outputs: BackendOutput[]
}

export interface EngineSummary {
  engine: string
  backendName: string
  totalMs: number
  avgMs: number
  totalChars: number
  failures: number
}

interface RenderMarkdownOptions {
  asin: string
  format: 'plain' | 'markdown'
  comparisons: PageComparison[]
  summaries: EngineSummary[]
}

export function summarise(
  comparisons: PageComparison[],
  engines: string[]
): EngineSummary[] {
  function outputsForEngine(engine: string): BackendOutput[] {
    const outputs: BackendOutput[] = []
    for (const comparison of comparisons) {
      for (const output of comparison.outputs) {
        if (output.engine === engine) {
          outputs.push(output)
        }
      }
    }
    return outputs
  }

  return engines.map((engine): EngineSummary => {
    const outputs = outputsForEngine(engine)
    const totalMs = outputs.reduce((acc, output) => acc + output.durationMs, 0)
    const totalChars = outputs.reduce((acc, output) => acc + output.chars, 0)
    const failures = outputs.filter((output) => output.error).length
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

export function renderMarkdown({
  asin,
  format,
  comparisons,
  summaries
}: RenderMarkdownOptions): string {
  const lines: string[] = [
    '# OCR Backend Comparison',
    '',
    `- Book: \`${asin}\``,
    `- Pages: ${comparisons.length}`,
    `- Format: \`${format}\``,
    `- Engines: ${summaries.map((summary) => `\`${summary.engine}\` (${summary.backendName})`).join(', ')}`,
    '',
    '## Summary',
    '',
    '| Engine | Backend | Total ms | Avg ms/page | Total chars | Failures |',
    '|---|---|---:|---:|---:|---:|',
    ...summaries.map(
      (summary) =>
        `| ${summary.engine} | \`${summary.backendName}\` | ${summary.totalMs.toFixed(0)} | ${summary.avgMs.toFixed(0)} | ${summary.totalChars} | ${summary.failures} |`
    ),
    ''
  ]

  for (const comparison of comparisons) {
    lines.push(
      `## Page index ${comparison.index} — book page ${comparison.page} — \`${path.basename(comparison.screenshot)}\``,
      ''
    )
    for (const output of comparison.outputs) {
      const header = output.error
        ? `### ${output.engine} — ${output.durationMs.toFixed(0)} ms — FAILED`
        : `### ${output.engine} — ${output.durationMs.toFixed(0)} ms — ${output.chars} chars`
      lines.push(header, '')
      if (output.error) {
        lines.push('```', output.error, '```', '')
      } else {
        lines.push('```', output.text, '```', '')
      }
    }
    lines.push('---', '')
  }

  return lines.join('\n')
}

export function renderSummaryTable(summaries: EngineSummary[]): string {
  const rows = [
    ['Engine', 'Backend', 'Total ms', 'Avg ms/page', 'Chars', 'Fails'],
    ...summaries.map((summary) => [
      summary.engine,
      summary.backendName,
      summary.totalMs.toFixed(0),
      summary.avgMs.toFixed(0),
      `${summary.totalChars}`,
      `${summary.failures}`
    ])
  ]
  const widths = rows[0]!.map((_, i) =>
    Math.max(...rows.map((row) => row[i]!.length))
  )
  return rows
    .map((row) => row.map((cell, i) => cell.padEnd(widths[i]!)).join('  '))
    .join('\n')
}
