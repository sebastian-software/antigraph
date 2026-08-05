import type { OcrBackend } from './types'

import { createCliBackend } from './cli'
import { createMlxBackend, type MlxBackendOptions } from './mlx'
import { createOllamaBackend, type OllamaBackendOptions } from './ollama'

export { MLX_DEFAULTS } from './mlx'

export type OcrEngine = 'claude' | 'codex' | 'mlx' | 'ollama'
export const OCR_ENGINES: readonly OcrEngine[] = [
  'ollama',
  'mlx',
  'codex',
  'claude'
] as const
export const DEFAULT_OCR_ENGINE: OcrEngine = 'ollama'

export type OcrBackendOptions = MlxBackendOptions & OllamaBackendOptions

/**
 * Build the vision backend selected by `engine`. The only caller is the glyph
 * transcriber, which uses it for a single call: labelling one grid of isolated,
 * anonymous font glyphs (never book pages). Connection options are passed
 * straight through; defaults live in the backend module (OLLAMA_DEFAULTS,
 * MLX_DEFAULTS) so the CLI can surface them in --help. The per-request prompt is
 * supplied on each `transcribe` call, not here.
 *
 * Local model servers: Ollama (cross-platform, pull any vision model) and
 * MLX-VLM (Apple Silicon native). `codex` and `claude` instead shell out to an
 * installed coding CLI, so no local model server is needed — and frontier
 * vision reads the glyph grid more reliably than a small local model.
 *
 * Throws on unknown engines instead of silently falling back — a typo
 * should surface immediately rather than quietly hit a broken endpoint.
 */
export function createOcrBackend(
  engine: string,
  options: OcrBackendOptions = {}
): OcrBackend {
  switch (engine) {
    case 'ollama':
      return createOllamaBackend(options)
    case 'mlx':
      return createMlxBackend(options)
    case 'codex':
      return createCliBackend('codex')
    case 'claude':
      return createCliBackend('claude')
    default:
      throw new Error(
        `Unknown OCR engine "${engine}". Supported: ${OCR_ENGINES.join(', ')}`
      )
  }
}

export { OLLAMA_DEFAULTS } from './ollama'
export type { OcrBackend, OcrRequest } from './types'
