import { describe, expect, test } from 'vitest'

import type { TocItem } from './types'
import { parsePageNav, parseTocItems } from './playwright-utils'

describe('parsePageNav', () => {
  test('parses "Page N of M" into a page nav', () => {
    expect(parsePageNav('Page 5 of 200')).toEqual({ page: 5, total: 200 })
  })

  test('is case-insensitive', () => {
    expect(parsePageNav('page 5 of 200')).toEqual({ page: 5, total: 200 })
  })

  test('parses "Location N of M" into a location nav', () => {
    expect(parsePageNav('Location 123 of 4567')).toEqual({
      location: 123,
      total: 4567
    })
  })

  test('parses roman-numeral page labels into a location nav', () => {
    expect(parsePageNav('Page xiv of 300')).toEqual({
      location: 14,
      total: 300
    })
  })

  test('returns undefined for null or unrecognized input', () => {
    expect(parsePageNav(null)).toBeUndefined()
    expect(parsePageNav('')).toBeUndefined()
    expect(parsePageNav('nothing useful here')).toBeUndefined()
  })

  test('prefers arabic page match over location when both could apply', () => {
    // A "Page N of M" label should never also match the location branch.
    const result = parsePageNav('Page 10 of 100')
    expect(result).toEqual({ page: 10, total: 100 })
    expect(result).not.toHaveProperty('location')
  })
})

const make = (label: string, page?: number): TocItem =>
  ({ label, page }) as TocItem

describe('parseTocItems', () => {
  test('identifies the first numbered page as main content start', () => {
    const toc: TocItem[] = [
      make('Cover'),
      make('Title Page'),
      make('Chapter 1', 12),
      make('Chapter 2', 40)
    ]
    const { firstContentPageTocItem, firstPostContentPageTocItem } =
      parseTocItems(toc, { totalNumPages: 100 })

    expect(firstContentPageTocItem.label).toBe('Chapter 1')
    expect(firstPostContentPageTocItem).toBeUndefined()
  })

  test('flags "Acknowledgements" near the end as post-content', () => {
    const toc: TocItem[] = [
      make('Chapter 1', 12),
      make('Chapter 20', 380),
      make('Acknowledgements', 395)
    ]
    const { firstPostContentPageTocItem } = parseTocItems(toc, {
      totalNumPages: 400
    })

    expect(firstPostContentPageTocItem?.label).toBe('Acknowledgements')
  })

  test('does not flag acknowledgements appearing too early', () => {
    // Must be past 90% to count as post-content.
    const toc: TocItem[] = [
      make('Chapter 1', 12),
      make('Acknowledgements', 100),
      make('Chapter 2', 200)
    ]
    const { firstPostContentPageTocItem } = parseTocItems(toc, {
      totalNumPages: 400
    })

    expect(firstPostContentPageTocItem).toBeUndefined()
  })

  test('excludes "Epilogue" even when it sits past the 90% cutoff', () => {
    const toc: TocItem[] = [
      make('Chapter 1', 12),
      make('Epilogue', 380),
      make('About the Author', 395)
    ]
    const { firstPostContentPageTocItem } = parseTocItems(toc, {
      totalNumPages: 400
    })

    expect(firstPostContentPageTocItem?.label).toBe('About the Author')
  })

  test('detects a variety of post-content labels', () => {
    const labels = [
      'Acknowledgements',
      'About the Author',
      'Meet the Author',
      'Also by Someone',
      'Copyright',
      'Newsletter signup',
      'Chapter 1 Teaser',
      'Chapter 1 Preview',
      'Excerpt from Next Book',
      'Cast of Characters',
      'Timeline',
      'Other Titles',
      'Other Books',
      'Other Works',
      'Discover More',
      'Extras'
    ]

    for (const label of labels) {
      const toc: TocItem[] = [make('Chapter 1', 12), make(label, 395)]
      const { firstPostContentPageTocItem } = parseTocItems(toc, {
        totalNumPages: 400
      })
      expect(
        firstPostContentPageTocItem?.label,
        `expected "${label}" to be detected as post-content`
      ).toBe(label)
    }
  })

  test('throws when no TOC entry has a page number', () => {
    const toc: TocItem[] = [make('Cover'), make('Title Page')]
    expect(() => parseTocItems(toc, { totalNumPages: 100 })).toThrow(
      'Unable to find first valid page in TOC'
    )
  })
})
