import type { OcrBackend, OcrRequest } from './types'

import { OCR_PROMPTS } from './prompts'
import { cleanupOcrText } from './text-cleanup'

export const OLLAMA_DEFAULTS = {
  baseUrl: 'http://localhost:11434',
  model: 'glm-ocr'
} as const

// Safety rail: cap generation so a model that starts looping or
// hallucinating (qwen3-vl:2b-instruct under the markdown prompt does
// this — 21KB of output for a 1.2KB page) can't run the request out to
// the client-side timeout. A full book page rarely transcribes to more
// than ~600 tokens; 4096 leaves generous headroom before cutting off.
const DEFAULT_NUM_PREDICT = 4096

interface OllamaGenerateResponse {
  response: string
  done: boolean
  error?: string
}

export interface OllamaBackendOptions {
  /** Default: OLLAMA_DEFAULTS.baseUrl (http://localhost:11434). */
  baseUrl?: string
  /** Default: OLLAMA_DEFAULTS.model (glm-ocr). */
  model?: string
  /**
   * Full-override of the extraction prompt. Skips the plain/markdown
   * prompt selection in `./prompts`.
   */
  prompt?: string
}

/**
 * Local OCR backend hitting Ollama's native /api/generate endpoint.
 * Ollama's OpenAI-compat shim doesn't handle vision inputs correctly for
 * smaller models like GLM-OCR, so we post the base64 image directly to
 * the native endpoint as documented by zai-org/GLM-OCR.
 */
export function createOllamaBackend(
  options: OllamaBackendOptions = {}
): OcrBackend {
  const baseUrl = (options.baseUrl ?? OLLAMA_DEFAULTS.baseUrl).replace(
    /\/{1,16}$/,
    ''
  )
  const model = options.model ?? OLLAMA_DEFAULTS.model
  const promptOverride = options.prompt

  return {
    name: `ollama:${model}`,
    async transcribe({ imageBuffer, format = 'plain' }: OcrRequest) {
      const prompt = promptOverride ?? OCR_PROMPTS[format]
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          images: [imageBuffer.toString('base64')],
          stream: false,
          options: { temperature: 0, num_predict: DEFAULT_NUM_PREDICT }
        })
      })

      if (!res.ok) {
        throw new Error(
          `Ollama ${res.status} at ${baseUrl}/api/generate: ${await res.text()}`
        )
      }

      const body = (await res.json()) as OllamaGenerateResponse
      if (body.error) {
        throw new Error(`Ollama error: ${body.error}`)
      }

      return cleanupOcrText(body.response)
    }
  }
}
