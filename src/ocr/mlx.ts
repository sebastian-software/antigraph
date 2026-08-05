import type { OcrBackend, OcrRequest } from './types'

import { cleanupOcrText } from './text-cleanup'

// PaddleOCR-VL-1.5 is an OCR-specialised 0.9B model (~1.8 GB on disk,
// ~3.2 GB peak RAM), fast and loop-free. Alternatives via --model:
//   mlx-community/DeepSeek-OCR-8bit           ~6 GB, occasional loops
//   mlx-community/Qwen2.5-VL-3B-Instruct-4bit ~2 GB, general VL, slower
// NOTE: mlx-community/GLM-OCR-* currently returns empty output in
// mlx-vlm 0.4.4 — avoid for now.
export const MLX_DEFAULTS = {
  baseUrl: 'http://localhost:8080',
  model: 'mlx-community/PaddleOCR-VL-1.5-bf16'
} as const
// Safety rail identical in spirit to Ollama's num_predict — caps a model
// that starts looping (qwen-style) so one bad request can't burn the
// client-side timeout.
const DEFAULT_MAX_TOKENS = 4096

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string }
    finish_reason?: string
  }>
  error?: { message?: string } | string
}

export interface MlxBackendOptions {
  /** Default: MLX_DEFAULTS.baseUrl (http://localhost:8080). */
  baseUrl?: string
  /** Default: MLX_DEFAULTS.model (PaddleOCR-VL-1.5-bf16). */
  model?: string
}

/**
 * Local vision backend hitting MLX-VLM's OpenAI-compatible HTTP server.
 * Start the server before use:
 *   python -m mlx_vlm.server --model mlx-community/PaddleOCR-VL-1.5-bf16
 *
 * The server loads exactly one model at a time. To swap models, stop the
 * server and restart it with a different `--model`.
 */
export function createMlxBackend(options: MlxBackendOptions = {}): OcrBackend {
  const baseUrl = (options.baseUrl ?? MLX_DEFAULTS.baseUrl).replace(
    /\/{1,16}$/,
    ''
  )
  const model = options.model ?? MLX_DEFAULTS.model

  return {
    name: `mlx:${model}`,
    async transcribe({ imageBuffer, mimeType, prompt }: OcrRequest) {
      const dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: dataUrl } },
                { type: 'text', text: prompt }
              ]
            }
          ],
          max_tokens: DEFAULT_MAX_TOKENS,
          temperature: 0,
          stream: false
        })
      })

      if (!res.ok) {
        throw new Error(
          `MLX-VLM ${res.status} at ${baseUrl}/v1/chat/completions: ${await res.text()}`
        )
      }

      const body = (await res.json()) as OpenAIChatCompletionResponse
      if (body.error !== undefined) {
        const msg =
          typeof body.error === 'string'
            ? body.error
            : (body.error.message ?? 'unknown error')
        throw new Error(`MLX-VLM error: ${msg}`)
      }

      const text = body.choices?.[0]?.message?.content
      if (text === undefined || text === '') {
        throw new Error(
          `MLX-VLM returned no content (finish_reason: ${body.choices?.[0]?.finish_reason ?? 'unknown'})`
        )
      }

      return cleanupOcrText(text)
    }
  }
}
