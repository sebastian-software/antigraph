import fs from 'node:fs/promises'
import path from 'node:path'

import type {
  AmazonRenderLocationMap,
  BookMetadata,
  Chapter,
  ContentChunk,
  TocItem
} from './types'
import {
  assert,
  dehyphenateAcrossPages,
  readJsonFile,
  tryReadJsonFile
} from './utils'

interface RenderPageInfo {
  startPositionId: number
  endPositionId: number
}

export interface AssembleOptions {
  asin: string
  outDir: string
}

/**
 * Scan render/*\/page_data_*.json files for per-page positionId ranges.
 * Amazon's render TAR is the source of truth for *where* each Kindle page
 * sits in the positionId scale — content.json only carries label page
 * numbers, which are ambiguous (roman + arabic schemes collide).
 */
async function loadRenderPageInfo(outDir: string): Promise<RenderPageInfo[]> {
  const renderRoot = path.join(outDir, 'render')
  const subdirs = await fs.readdir(renderRoot).catch(() => [] as string[])
  const byStart = new Map<number, RenderPageInfo>()
  for (const sub of subdirs) {
    const stat = await fs.stat(path.join(renderRoot, sub)).catch(() => null)
    if (!stat?.isDirectory()) continue
    const entries = await fs.readdir(path.join(renderRoot, sub)).catch(() => [])
    for (const name of entries) {
      if (!/^page_data_\d+_\d+\.json$/.test(name)) continue
      const pages = await tryReadJsonFile<
        Array<{ startPositionId?: number; endPositionId?: number }>
      >(path.join(renderRoot, sub, name))
      if (!Array.isArray(pages)) continue
      for (const p of pages) {
        if (
          typeof p.startPositionId !== 'number' ||
          typeof p.endPositionId !== 'number'
        ) {
          continue
        }
        byStart.set(p.startPositionId, {
          startPositionId: p.startPositionId,
          endPositionId: p.endPositionId
        })
      }
    }
  }
  return [...byStart.values()].toSorted(
    (a, b) => a.startPositionId - b.startPositionId
  )
}

/**
 * Group raw per-page OCR output (`content.json`) into chapter-shaped units
 * using the book's TOC. Page boundaries are Kindle layout artefacts — the
 * semantic units are chapters (and parts / front-matter / back-matter).
 *
 * Writes `<outDir>/<asin>/chapters.json` as the intermediate representation
 * consumed by cleanup, review, and export stages downstream.
 *
 * TOC-ordering rules learned from Kindle's data:
 *   - `positionId` is monotonic in reading order; `page` labels are not
 *     (front-matter vs main-body use different numbering systems).
 *   - Amazon routinely puts post-book metadata entries ("Also by",
 *     "Copyright", "About the Publisher") into the TOC with very low page
 *     numbers but very high positionIds. `nav.endContentPosition` cuts
 *     cleanly against those.
 */

function slugify(label: string): string {
  return label
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replaceAll(/[^\da-z]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 80)
}

function validTocItems(toc: TocItem[], endContentPosition: number): TocItem[] {
  return toc
    .filter((t) => t.positionId <= endContentPosition && t.page !== undefined)
    .toSorted((a, b) => a.positionId - b.positionId)
}

interface ChapterBoundary {
  toc: TocItem
  firstContentIdx: number
  lastContentIdx: number // inclusive
}

/**
 * Resolve each content chunk's exact `startPositionId` by greedy-matching
 * the sequence of captured chunks to the sequence of render pages via
 * their Kindle *label* page number.
 *
 * Kindle's `locationMap.navigationUnit` maps positionId → label page.
 * Render `page_data_*.json` gives every rendered page's positionId range.
 * Content chunks carry only the label page. Because captures happen in
 * reading order and may skip pages on navigation failures, we walk both
 * lists in parallel and greedily consume the next render entry whose
 * label page matches the current chunk's label page — this absorbs gaps
 * (skipped captures) naturally and stays correct when a label page spans
 * multiple render pages (common for printed pages rendered as 2 halves).
 */
function resolveChunkPositionIds(
  content: ContentChunk[],
  renderPages: RenderPageInfo[],
  locationMap: AmazonRenderLocationMap | undefined
): number[] {
  const out = Array.from<number>({ length: content.length }).fill(-1)
  const nav = (locationMap?.navigationUnit ?? []).toSorted(
    (a, b) => a.startPosition - b.startPosition
  )
  if (nav.length === 0 || renderPages.length === 0) return out

  const labelPageFor = (pos: number): number => {
    let lo = 0
    let hi = nav.length - 1
    let bestPage = -1
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      if (nav[mid]!.startPosition <= pos) {
        bestPage = nav[mid]!.page
        lo = mid + 1
      } else hi = mid - 1
    }
    return bestPage
  }

  const renderLabels = renderPages.map((r) => labelPageFor(r.startPositionId))

  let cursor = 0
  for (const [i, element] of content.entries()) {
    const target = element.page
    while (cursor < renderPages.length && renderLabels[cursor] !== target) {
      cursor++
    }
    if (cursor >= renderPages.length) break
    out[i] = renderPages[cursor]!.startPositionId
    cursor++
  }

  // Fill any unresolved trailing chunks with monotonic increments so the
  // boundary search still behaves. Front-matter gaps at the start keep -1
  // which places them before every TOC positionId.
  let lastKnown = -1
  for (let i = 0; i < out.length; i++) {
    if (out[i]! >= 0) lastKnown = out[i]!
    else if (lastKnown >= 0) out[i] = lastKnown + 1
  }
  return out
}

/**
 * Map TOC positionIds to content.json indices via each chunk's exact
 * startPositionId. A chapter begins at the first content chunk whose
 * startPositionId is >= the TOC entry's positionId; it ends one chunk
 * before the next chapter's first chunk.
 *
 * Items that resolve to the same chunk as their successor (Part / section
 * headings immediately followed by their first chapter, or front-matter
 * entries that were never captured) collapse to zero-length slices.
 */
function computeBoundaries(
  toc: TocItem[],
  content: ContentChunk[],
  renderPages: RenderPageInfo[],
  locationMap: AmazonRenderLocationMap | undefined
): ChapterBoundary[] {
  if (toc.length === 0 || content.length === 0) return []

  const chunkPos = resolveChunkPositionIds(content, renderPages, locationMap)

  const firstChunkAtOrAfter = (positionId: number): number => {
    // Lowest i such that chunkPos[i] >= positionId; content.length if none.
    let lo = 0
    let hi = content.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (chunkPos[mid]! < positionId) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  const anchors = toc.map((t) => firstChunkAtOrAfter(t.positionId))

  return toc.map((item, i) => {
    const firstContentIdx = Math.min(anchors[i]!, content.length - 1)
    const nextAnchor = anchors[i + 1]
    let lastContentIdx: number
    if (nextAnchor === undefined) {
      lastContentIdx = content.length - 1
    } else if (nextAnchor > firstContentIdx) {
      lastContentIdx = Math.min(nextAnchor, content.length) - 1
    } else {
      // Collapsed anchor — this TOC entry shares its first chunk with the
      // next TOC entry (e.g. "Part I" → "Chapter 1") or points before any
      // captured content (front-matter). Emit a zero-length slice.
      lastContentIdx = firstContentIdx - 1
    }
    return { toc: item, firstContentIdx, lastContentIdx }
  })
}

function assembleChapterText(entries: ContentChunk[]): {
  text: string
  contentIndices: number[]
} {
  if (entries.length === 0) return { text: '', contentIndices: [] }

  // Dehyphenate works on the chunks in-order; operate on a copy so we
  // don't mutate the caller's ContentChunks.
  const copies = entries.map((e) => ({ ...e }))
  dehyphenateAcrossPages(copies)

  const text = copies
    .map((c) => c.text.trim())
    .filter(Boolean)
    .join('\n\n')

  const contentIndices = entries.map((e) => e.index)
  return { text, contentIndices }
}

export async function runAssemble(options: AssembleOptions): Promise<void> {
  const bookDir = path.join(options.outDir, options.asin)
  const metadata = await readJsonFile<BookMetadata>(
    path.join(bookDir, 'metadata.json')
  )
  const content = await readJsonFile<ContentChunk[]>(
    path.join(bookDir, 'content.json')
  )

  assert(metadata.toc?.length, 'metadata has no toc')
  assert(content.length > 0, 'content.json is empty')

  const toc = validTocItems(
    metadata.toc,
    metadata.nav?.endContentPosition ?? Number.POSITIVE_INFINITY
  )
  assert(toc.length > 0, 'no usable TOC entries with page numbers')

  const renderPages = await loadRenderPageInfo(bookDir)
  if (renderPages.length === 0) {
    console.warn(
      'warning: no render page_data found — chapter boundaries will be unreliable'
    )
  }

  const boundaries = computeBoundaries(
    toc,
    content,
    renderPages,
    metadata.locationMap
  )

  const chapters: Chapter[] = boundaries.map((b, i) => {
    const entries = content.slice(b.firstContentIdx, b.lastContentIdx + 1)
    const { text, contentIndices } = assembleChapterText(entries)
    return {
      index: i,
      depth: b.toc.depth,
      title: b.toc.label,
      slug: slugify(b.toc.label) || `section-${i}`,
      startPositionId: b.toc.positionId,
      startPage: entries[0]?.page ?? -1,
      endPage: entries.at(-1)?.page ?? -1,
      contentIndices,
      text
    }
  })

  const chaptersPath = path.join(bookDir, 'chapters.json')
  await fs.writeFile(chaptersPath, JSON.stringify(chapters, null, 2))

  const withText = chapters.filter((c) => c.text.length > 0).length
  const empty = chapters.length - withText
  console.log(
    `wrote ${chapters.length} chapters (${withText} with text, ${empty} empty) to ${chaptersPath}`
  )
  for (const c of chapters) {
    const marker = c.depth === 0 ? ' · ' : '   ↳ '
    console.log(
      `${marker}${c.title.padEnd(50)}  p.${c.startPage}-${c.endPage}  ${c.text.length}c`
    )
  }
}
