export interface OcrRequest {
  /** The image the vision model should read. */
  imageBuffer: Buffer
  /** Mime type of `imageBuffer`, e.g. "image/png". */
  mimeType: string
  /** Instruction sent to the model alongside the image (e.g. the glyph-grid label prompt). */
  prompt: string
}

export interface OcrBackend {
  /** Short identifier for logs, e.g. "cli:codex". */
  readonly name: string
  /** Run the vision model on one image and return the text it reads. */
  transcribe: (req: OcrRequest) => Promise<string>
}
