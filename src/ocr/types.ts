export type OcrFormat = 'plain' | 'markdown'

export interface OcrRequest {
  imageBuffer: Buffer
  /** Mime type of `imageBuffer`, e.g. "image/webp". */
  mimeType: string
  /** Page index — used only for diagnostics / logs. */
  index: number
  /** Screenshot path — used only for diagnostics / logs. */
  screenshot: string
  /**
   * How the model should structure its output. "plain" transcribes verbatim
   * without markup; "markdown" preserves basic structure (headings, lists,
   * block quotes, emphasis). Defaults to "plain".
   */
  format?: OcrFormat
}

export interface OcrBackend {
  /** Short identifier for logs, e.g. "openai:gpt-4.1-mini". */
  readonly name: string
  /** Run OCR on a single image and return the extracted text verbatim. */
  transcribe(req: OcrRequest): Promise<string>
}
