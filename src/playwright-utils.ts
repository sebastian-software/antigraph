/* eslint-disable @typescript-eslint/no-non-null-asserted-optional-chain */
import type { PageNav, TocItem } from './types'

import { assert, deromanize } from './utils'

const POST_CONTENT_TOC_PATTERNS = [
  /acknowledgements/i,
  /^discover more$/i,
  /^extras$/i,
  /about the author/i,
  /meet the author/i,
  /^also by /i,
  /^copyright$/i,
  / teaser$/i,
  / preview$/i,
  /^excerpt from/i,
  /^excerpt:/i,
  /^cast of characters$/i,
  /^timeline$/i,
  /^other titles/i,
  /^other books/i,
  /^other works/i,
  /^newsletter/i
]

function isLikelyPostContentLabel(label: string): boolean {
  for (const pattern of POST_CONTENT_TOC_PATTERNS) {
    if (pattern.test(label)) {
      return true
    }
  }
  return false
}

export function parsePageNav(text: null | string): PageNav | undefined {
  {
    // Parse normal page locations
    const match = text?.match(/page\s+(\d+)\s+of\s+(\d+)/i)
    if (match) {
      const page = Number.parseInt(match?.[1]!, 10)
      const total = Number.parseInt(match?.[2]!, 10)
      if (Number.isNaN(page) || Number.isNaN(total)) {
        return undefined
      }

      return { page, total }
    }
  }

  {
    // Parse locations which are not part of the main book pages
    // (toc, copyright, title, etc)
    const match = text?.match(/location\s+(\d+)\s+of\s+(\d+)/i)
    if (match) {
      const location = Number.parseInt(match?.[1]!, 10)
      const total = Number.parseInt(match?.[2]!, 10)
      if (Number.isNaN(location) || Number.isNaN(total)) {
        return undefined
      }

      return { location, total }
    }
  }

  {
    // Parse locations which use roman numerals
    const match = text?.match(/page\s+([cdilmvx]+)\s+of\s+(\d+)/i)
    if (match) {
      const location = deromanize(match?.[1]!)
      const total = Number.parseInt(match?.[2]!, 10)
      if (Number.isNaN(location) || Number.isNaN(total)) {
        return undefined
      }

      return { location, total }
    }
  }

  return undefined
}

export function parseTocItems(
  tocItems: TocItem[],
  { totalNumPages }: { totalNumPages: number }
): {
  firstContentPageTocItem: TocItem
  firstPostContentPageTocItem?: TocItem
} {
  // Find the first page in the TOC which contains the main book content
  // (after the title, table of contents, copyright, etc)
  const firstContentPageTocItem = tocItems.find(
    (item) => item.page !== undefined
  )
  assert(firstContentPageTocItem, 'Unable to find first valid page in TOC')

  // Try to find the first page in the TOC after the main book content
  // (e.g. acknowledgements, about the author, etc)
  const firstPostContentPageTocItem = tocItems.find((item) => {
    if (item.page === undefined) return false
    if (item === firstContentPageTocItem) return false

    const percentage = item.page / totalNumPages
    if (percentage < 0.9) return false

    // (epilogue purposefully shortened here)
    if (/^epilog/i.test(item.label)) return false

    return isLikelyPostContentLabel(item.label)
  })

  if (firstPostContentPageTocItem) {
    return {
      firstContentPageTocItem,
      firstPostContentPageTocItem
    }
  }

  return { firstContentPageTocItem }
}
