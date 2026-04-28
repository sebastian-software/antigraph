export { type AssembleOptions, runAssemble } from './assemble-chapters'
export {
  cleanChapterText,
  mergeSplitParagraphs,
  normalizeWhitespace,
  stripChapterHeading
} from './chapter-cleanup'
export { type CleanupOptions, runCleanup } from './cleanup-chapters'
export { parsePositiveInt } from './cli-utils'
export {
  type CompareOptions,
  DEFAULT_COMPARE_ENGINES,
  DEFAULT_COMPARE_PAGES,
  DEFAULT_COMPARE_TIMEOUT_MS,
  runCompare
} from './compare-ocr-backends'
export { type ExportOptions, runExport } from './export-book-markdown'
export { type ExtractOptions, runExtract } from './extract-kindle-book'
export {
  createOcrBackend,
  DEFAULT_OCR_ENGINE,
  MLX_DEFAULTS,
  OCR_ENGINES,
  type OcrBackend,
  type OcrBackendOptions,
  type OcrEngine,
  type OcrFormat,
  type OcrRequest,
  OLLAMA_DEFAULTS
} from './ocr'
export { parsePageNav, parseTocItems } from './playwright-utils'
export {
  runTranscribe,
  type TranscribeOptions
} from './transcribe-book-content'
export type * from './types'
export {
  assert,
  dehyphenateAcrossPages,
  deromanize,
  escapeRegExp,
  extractTar,
  fileExists,
  hashObject,
  normalizeAuthors,
  normalizeBookMetadata,
  parseJsonpResponse,
  parsePageLabel,
  readJsonFile,
  tryReadJsonFile
} from './utils'
