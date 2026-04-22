import fs from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import hashObjectImpl from 'hash-object'
import sortKeys from 'sort-keys'
import { extract } from 'tar'
import { temporaryDirectory } from 'tempy'

import type { BookMetadata } from './types'

export function escapeRegExp(s: string): string {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function assert(
  value: unknown,
  message?: string | Error
): asserts value {
  if (value) {
    return
  }

  if (!message) {
    throw new Error('Assertion failed')
  }

  throw typeof message === 'string' ? new Error(message) : message
}

export function normalizeAuthors(rawAuthors: string[]): string[] {
  if (!rawAuthors?.length) {
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

const JSONP_REGEX = /\(({.*})\)/

export function parseJsonpResponse<T = unknown>(body: string): T | undefined {
  const content = body?.match(JSONP_REGEX)?.[1]
  if (!content) {
    return undefined
  }

  try {
    return JSON.parse(content) as T
  } catch {
    return undefined
  }
}
const numerals = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }

export function deromanize(romanNumeral: string): number {
  const roman = romanNumeral.toUpperCase().split('')
  let num = 0

  while (roman.length) {
    const val = numerals[roman.shift()! as keyof typeof numerals]
    num += val * (val < numerals[roman[0] as keyof typeof numerals] ? -1 : 1)
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
  const trimmed = label?.trim()
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

export function hashObject(obj: Record<string, any>): string {
  return hashObjectImpl(obj, {
    algorithm: 'sha1',
    encoding: 'hex'
  })
}

/**
 * Decompress a TAR (optionally .tar.gz/.tgz) Buffer to a fresh temp directory.
 * Returns the absolute path of the temp directory.
 */
export async function extractTar(
  buf: Buffer,
  {
    strip = 0,
    cwd = temporaryDirectory()
  }: { strip?: number; cwd?: string } = {}
): Promise<string> {
  const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b

  try {
    const extractor = extract({
      cwd,
      gzip: isGzip,
      strip
    })

    await pipeline(Readable.from(buf), extractor)
    return cwd
  } catch (err) {
    // Clean up the temp dir if extraction fails
    await fs.rm(cwd, { recursive: true, force: true }).catch(() => {})
    throw err
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

const bookMetadataFieldOrder: (keyof BookMetadata)[] = [
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
  return sortKeys(book, { compare: bookMetadataFieldComparator })
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
  const endPattern = /(\p{Ll}\p{L}*)-\s*$/u
  const startPattern = /^(\p{L}+)\s*/u

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
