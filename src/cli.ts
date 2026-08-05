import { defineCommand, runMain } from 'citty'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'

import {
  DEFAULT_OCR_ENGINE,
  MLX_DEFAULTS,
  OCR_ENGINES,
  OLLAMA_DEFAULTS,
  pipelineArgsFromCli,
  runPipeline,
  STAGE_ORDER
} from './cli-pipeline'
import { assert } from './utils'

const require = createRequire(import.meta.url)
const VERSION = (require('../package.json') as { version: string }).version

const runCmd = defineCommand({
  meta: {
    name: 'run',
    description:
      'Full pipeline: pick a book (if --asin omitted), capture pages, reconstruct text, assemble + clean + export Markdown.'
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
      description: `Vision engine for glyph labelling (${OCR_ENGINES.join(' | ')}).`
    },
    model: {
      type: 'string',
      description:
        'Vision model override (ollama/mlx engines). Defaults: ollama → glm-ocr; mlx → mlx-community/PaddleOCR-VL-1.5-bf16.'
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
    }
  },
  async run({ args }) {
    await runPipeline(pipelineArgsFromCli(args))
  }
})

assert(runCmd.args !== undefined, 'run command args must be defined')
assert(runCmd.run !== undefined, 'run command handler must be defined')

export const main = defineCommand({
  meta: {
    name: 'antigraph',
    version: VERSION,
    description:
      'Turns Kindle books you own into clean, chapter-scoped Markdown.'
  },
  args: runCmd.args,
  subCommands: {
    run: runCmd
  },
  run: runCmd.run
})

function isDirectCliEntrypoint(argvPath: string | undefined): boolean {
  if (argvPath === undefined) return false

  return realpathSync(argvPath) === realpathSync(import.meta.filename)
}

if (isDirectCliEntrypoint(process.argv[1])) {
  await runMain(main)
}
