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
 * Build the OCR backend selected by `engine`. Options are passed straight
 * through to the backend factory; defaults live in the backend module
 * (OLLAMA_DEFAULTS, MLX_DEFAULTS) so the CLI can surface them in --help.
 *
 * Local model servers: Ollama (cross-platform, pull any vision model) and
 * MLX-VLM (Apple Silicon native). `codex` and `claude` instead shell out to an
 * installed coding CLI — added for the glyph transcriber's single grid
 * labelling call, which sends only anonymous font glyphs, so no local model is
 * needed. Note that pairing a CLI engine with the *page* OCR transcriber would
 * send book-page images to a third party; keep CLI engines to glyph labelling.
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
      return createCliBackend('codex', options)
    case 'claude':
      return createCliBackend('claude', options)
    default:
      throw new Error(
        `Unknown OCR engine "${engine}". Supported: ${OCR_ENGINES.join(', ')}`
      )
  }
}

export { OLLAMA_DEFAULTS } from './ollama'
export type { OcrBackend, OcrFormat, OcrRequest } from './types'
