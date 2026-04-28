import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { extract } from 'tar'

import type { BookMetadata } from './types'

export function escapeRegExp(s: string): string {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function assert(
  value: unknown,
  message?: Error | string
): asserts value {
  if (isTruthy(value)) {
    return
  }

  if (message === undefined || message === '') {
    throw new Error('Assertion failed')
  }

  throw typeof message === 'string' ? new Error(message) : message
}

function isTruthy(value: unknown): boolean {
  return (
    value !== false &&
    value !== 0 &&
    value !== 0n &&
    value !== '' &&
    value !== null &&
    value !== undefined &&
    (typeof value !== 'number' || !Number.isNaN(value))
  )
}

export function normalizeAuthors(rawAuthors: string[]): string[] {
  if (rawAuthors.length === 0) {
    return []
  }

  const rawAuthor = rawAuthors[0]!

  return Array.from(new Set(rawAuthor.split(':').filter(Boolean)), (authors) =>
    authors
      .split(',')
      .map((elems) => elems.trim())
      .toReversed()
      .join(' ')
  )
}

const JSONP_REGEX = /\((\{.*\})\)/

export function parseJsonpResponse(body: string): unknown {
  const content = JSONP_REGEX.exec(body)?.[1]
  if (content === undefined || content === '') {
    return undefined
  }

  try {
    return JSON.parse(content) as unknown
  } catch {
    return undefined
  }
}
const numerals = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }

export function deromanize(romanNumeral: string): number {
  const roman = romanNumeral.toUpperCase()
  let num = 0

  for (let index = 0; index < roman.length; index += 1) {
    const val = numerals[roman[index] as keyof typeof numerals]
    const next = numerals[roman[index + 1] as keyof typeof numerals]
    num += val * (val < next ? -1 : 1)
  }

  return num
}

/**
 * Parse a page label as either an Arabic integer ("42") or a Roman numeral
 * ("iv", "XIV"). Returns NaN for anything else — callers decide whether to
 * skip or flag the entry. Kindle's locationMap uses Roman numerals for
 * front-matter pages, which is why a plain Number.parseInt doesn't cut it.
 */
export function parsePageLabel(label: string): number {
  const trimmed = label.trim()
  if (!trimmed) return Number.NaN

  const arabic = Number.parseInt(trimmed, 10)
  if (!Number.isNaN(arabic) && String(arabic) === trimmed) return arabic

  if (/^[ivxlcdm]+$/i.test(trimmed)) {
    const roman = deromanize(trimmed)
    if (Number.isFinite(roman) && roman > 0) return roman
  }

  return Number.NaN
}

export async function fileExists(
  filePath: string,
  mode: number = fs.constants.F_OK | fs.constants.R_OK
): Promise<boolean> {
  try {
    await fs.access(filePath, mode)
    return true
  } catch {
    return false
  }
}

function stableStringify(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value !== 'object') {
    const json = JSON.stringify(value) as string | undefined
    return json ?? 'undefined'
  }

  if (seen.has(value)) {
    return JSON.stringify('[Circular]')
  }

  seen.add(value)
  if (Array.isArray(value)) {
    const serializedArray = `[${value.map((item) => stableStringify(item, seen)).join(',')}]`
    seen.delete(value)
    return serializedArray
  }

  const serialized = `{${Object.entries(value)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue, seen)}`
    )
    .join(',')}}`
  seen.delete(value)
  return serialized
}

export function hashObject(obj: Record<string, unknown>): string {
  return createHash('sha1').update(stableStringify(obj)).digest('hex')
}

/**
 * Decompress a TAR (optionally .tar.gz/.tgz) Buffer to a fresh temp directory.
 * Returns the absolute path of the temp directory.
 */
export async function extractTar(
  buf: Buffer,
  { strip = 0, cwd }: { strip?: number; cwd?: string } = {}
): Promise<string> {
  const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
  const targetCwd =
    cwd ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'antigraph-')))

  try {
    const extractor = extract({
      cwd: targetCwd,
      gzip: isGzip,
      strip
    })

    await pipeline(Readable.from(buf), extractor)
    return targetCwd
  } catch (error) {
    try {
      await fs.rm(targetCwd, { recursive: true, force: true })
    } catch {
      // Ignore cleanup failure so the original extraction error is preserved.
    }
    throw error
  }
}

export async function readJsonFile<T = unknown>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
}

export async function tryReadJsonFile<T = unknown>(
  filePath: string
): Promise<T | undefined> {
  try {
    // The `await` matters: without it the rejection escapes the try/catch
    // and bubbles up as an unhandled error (bit me while extracting a book
    // whose /renderer/render TARs had no location_map.json).
    return await readJsonFile<T>(filePath)
  } catch {
    return undefined
  }
}

const bookMetadataFieldOrder: Array<keyof BookMetadata> = [
  'meta',
  'info',
  'nav',
  'toc',
  'pages',
  'locationMap'
]

const bookMetadataFieldsOrderMap = Object.fromEntries(
  bookMetadataFieldOrder.map((f, i) => [f, i])
)

function bookMetadataFieldComparator(a: string, b: string): number {
  const aIndex = bookMetadataFieldsOrderMap[a] ?? Infinity
  const bIndex = bookMetadataFieldsOrderMap[b] ?? Infinity

  return aIndex - bIndex
}
export function normalizeBookMetadata(
  book: Partial<BookMetadata>
): Partial<BookMetadata> {
  return Object.fromEntries(
    Object.entries(book).toSorted(([a], [b]) =>
      bookMetadataFieldComparator(a, b)
    )
  )
}

/**
 * Merge words split across page boundaries by soft hyphens (word-wrap).
 * Walks the page chunks in order; when one ends with a lowercase-prefixed
 * hyphenated word and the next starts with a letter, joins them into one
 * word on the first page and drops the partial from the second.
 *
 * Only triggers when the character immediately before the hyphen is a
 * lowercase letter — that matches typical syllable hyphenation while
 * leaving intentional compound hyphens like "E-Mail" alone. Mutates
 * `chunks` in place and returns the same array for convenience.
 */
export function dehyphenateAcrossPages<T extends { text: string }>(
  chunks: T[]
): T[] {
  const endPattern = /(\p{Ll}\p{L}{0,80})-\s*$/u
  const startPattern = /^(\p{L}{1,80})\s*/u

  for (let i = 0; i < chunks.length - 1; i++) {
    const endMatch = endPattern.exec(chunks[i]!.text)
    if (!endMatch) continue

    const startMatch = startPattern.exec(chunks[i + 1]!.text)
    if (!startMatch) continue

    const merged = endMatch[1]! + startMatch[1]!
    chunks[i]!.text = chunks[i]!.text.replace(endPattern, merged)
    chunks[i + 1]!.text = chunks[i + 1]!.text.replace(startPattern, '')
  }

  return chunks
}
