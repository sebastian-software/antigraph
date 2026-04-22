import type { OcrBackend, OcrRequest } from './types'
import { OCR_PROMPTS } from './prompts'

// PaddleOCR-VL-1.5 is an OCR-specialised 0.9B model (~1.8 GB on disk,
// ~3.2 GB peak RAM). On a 10-page sample it was 1.25× faster than
// ollama:glm-ocr at matching char counts, with zero loops/hallucinations.
// Alternatives via --model:
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

/**
 * Models that refuse to generate output when given the generic
 * `OCR_PROMPTS[format]` instruction block. They're tuned for a specific
 * terse prompt shape from their model card and treat long instructional
 * prompts as an early-stop signal (1 output token, `finish_reason: stop`).
 * Keeping this list tiny and explicit — a per-family override is less
 * surprising than silently swapping everyone's prompt.
 */
const MODEL_SPECIFIC_PROMPTS: Record<
  string,
  Partial<Record<'plain' | 'markdown', string>>
> = {
  'deepseek-ocr': {
    plain: 'Free OCR.',
    markdown: 'Convert the document to markdown.'
  },
  // PaddleOCR-VL loops into `- Title: {Title}\n- Subtitle: {Subtitle}\n…`
  // on ~1 in 10 pages when given either our elaborate markdown prompt
  // OR the generic "Convert the document to markdown.". The terse "OCR."
  // prompt is the model card's canonical invocation and stays stable.
  'paddleocr-vl': {
    plain: 'OCR.',
    markdown: 'OCR.'
  }
}

function pickModelSpecificPrompt(
  model: string,
  format: 'plain' | 'markdown'
): string | undefined {
  const lower = model.toLowerCase()
  for (const [key, prompts] of Object.entries(MODEL_SPECIFIC_PROMPTS)) {
    if (lower.includes(key)) return prompts[format]
  }
  return undefined
}

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
  /**
   * Full-override of the extraction prompt. Skips the plain/markdown
   * prompt selection in `./prompts` and the model-family-specific
   * prompt map.
   */
  prompt?: string
}

/**
 * Local OCR backend hitting MLX-VLM's OpenAI-compatible HTTP server.
 * Start the server before use:
 *   python -m mlx_vlm.server --model mlx-community/PaddleOCR-VL-1.5-bf16
 *
 * The server loads exactly one model at a time. To benchmark a second
 * model, stop the server and restart it with a different `--model`.
 */
export function createMlxBackend(options: MlxBackendOptions = {}): OcrBackend {
  const baseUrl = (options.baseUrl ?? MLX_DEFAULTS.baseUrl).replace(/\/+$/, '')
  const model = options.model ?? MLX_DEFAULTS.model
  const promptOverride = options.prompt

  return {
    name: `mlx:${model}`,
    async transcribe({ imageBuffer, mimeType, format = 'plain' }: OcrRequest) {
      const prompt =
        promptOverride ??
        pickModelSpecificPrompt(model, format) ??
        OCR_PROMPTS[format]
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
      if (body.error) {
        const msg =
          typeof body.error === 'string'
            ? body.error
            : (body.error.message ?? 'unknown error')
        throw new Error(`MLX-VLM error: ${msg}`)
      }

      const text = body.choices?.[0]?.message?.content
      if (!text) {
        throw new Error(
          `MLX-VLM returned no content (finish_reason: ${body.choices?.[0]?.finish_reason ?? 'unknown'})`
        )
      }

      return text
        .replace(/^\s*\d+\s*$\n+/m, '')
        .replaceAll(/^\s*/gm, '')
        .replaceAll(/\s*$/gm, '')
    }
  }
}
