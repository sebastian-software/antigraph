import type { OcrBackend } from './types'
import { createMlxBackend, type MlxBackendOptions } from './mlx'
import { createOllamaBackend, type OllamaBackendOptions } from './ollama'

export type { OcrBackend, OcrFormat, OcrRequest } from './types'

export type OcrEngine = 'ollama' | 'mlx'
export const OCR_ENGINES: readonly OcrEngine[] = ['ollama', 'mlx'] as const
export const DEFAULT_OCR_ENGINE: OcrEngine = 'ollama'

export type OcrBackendOptions = OllamaBackendOptions & MlxBackendOptions

/**
 * Build the OCR backend selected by `engine`. Options are passed straight
 * through to the backend factory; defaults live in the backend module
 * (OLLAMA_DEFAULTS, MLX_DEFAULTS) so the CLI can surface them in --help.
 *
 * Only local backends are supported: Ollama (cross-platform, pull any
 * vision model) and MLX-VLM (Apple Silicon native, typically faster on
 * the same weights). Cloud backends were removed because uploading page
 * screenshots of copyrighted books to third-party providers is legally
 * murky, and the cloud models didn't meaningfully beat OCR-tuned local
 * ones on accuracy anyway.
 *
 * Throws on unknown engines instead of silently falling back — a typo
 * should surface immediately rather than quietly hit a broken endpoint.
 */
export function createOcrBackend(
  engine: OcrEngine | string,
  options: OcrBackendOptions = {}
): OcrBackend {
  switch (engine) {
    case 'ollama':
      return createOllamaBackend(options)
    case 'mlx':
      return createMlxBackend(options)
    default:
      throw new Error(
        `Unknown OCR engine "${engine}". Supported: ${OCR_ENGINES.join(', ')}`
      )
  }
}

export { MLX_DEFAULTS } from './mlx'
export { OLLAMA_DEFAULTS } from './ollama'
