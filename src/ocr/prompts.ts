import type { OcrFormat } from './types'

/**
 * Single source of truth for what we ask the OCR model to produce, keyed by
 * output format. Keeping it here means every backend (OpenAI, Anthropic,
 * Gemini, Ollama, …) asks for the same thing — differences in output are
 * then about the model, not the prompt.
 *
 * The wording is deliberately terse: vision models tend to over-explain
 * when the prompt is chatty, and OCR-specialised models (like GLM-OCR)
 * just ignore long instructions anyway.
 */
export const OCR_PROMPTS: Record<OcrFormat, string> = {
  plain: `You will be given an image containing text. Read the text from the image and output it verbatim.

Do not include any additional text, descriptions, or commentary. Ignore any embedded images. Do not use markdown.`,

  markdown: `You will be given an image of a printed book page. Transcribe the text into Markdown, preserving the page's visual structure:

- Use # for top-level titles (chapter / part titles), ## for sections, ### for subsections.
- Use - for bullet lists and 1. for numbered lists, matching what's on the page.
- Use > for block quotes — indented or stylistically set-off passages that are clearly distinct from the main body.
- Use *italic* and **bold** where the original clearly uses italic or bold.
- Preserve paragraph breaks as blank lines.
- Do not invent content, commentary, or headings that aren't visible on the page.
- Do not wrap the output in code fences. Output the Markdown directly.`
}
