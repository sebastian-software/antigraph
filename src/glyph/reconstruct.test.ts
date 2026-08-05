import { describe, expect, it } from 'vitest'

import type { GlyphMap, GlyphRun, LayoutPage } from './types'

import { buildPositionChars, reconstructPageText } from './reconstruct'

function glyphMap(entries: Record<string, Record<number, string>>): GlyphMap {
  const map: GlyphMap = new Map()
  for (const [fontKey, glyphs] of Object.entries(entries)) {
    map.set(
      fontKey,
      new Map(Object.entries(glyphs).map(([id, ch]) => [Number(id), ch]))
    )
  }
  return map
}

describe('buildPositionChars', () => {
  it('places each glyph at startPositionId + index', () => {
    const runs: GlyphRun[] = [
      {
        fontKey: 'body',
        startPositionId: 100,
        glyphIds: [1, 2, 3, 3, 4],
        italic: false,
        bold: false
      }
    ]
    const map = glyphMap({ body: { 1: 'H', 2: 'e', 3: 'l', 4: 'o' } })

    const positionChars = buildPositionChars(runs, map)

    expect(positionChars.get(100)?.char).toBe('H')
    expect(positionChars.get(104)?.char).toBe('o')
    expect([...positionChars.keys()]).toStrictEqual([100, 101, 102, 103, 104])
  })

  it('advances a ligature by its character length', () => {
    const runs: GlyphRun[] = [
      {
        fontKey: 'body',
        startPositionId: 300,
        glyphIds: [10, 11],
        italic: false,
        bold: false
      }
    ]
    const map = glyphMap({ body: { 10: 'fi', 11: 'x' } })

    const positionChars = buildPositionChars(runs, map)

    expect(positionChars.get(300)?.char).toBe('fi')
    expect(positionChars.get(301)).toBeUndefined()
    expect(positionChars.get(302)?.char).toBe('x')
  })

  it('uses a replacement char for unknown glyphs', () => {
    const runs: GlyphRun[] = [
      {
        fontKey: 'body',
        startPositionId: 0,
        glyphIds: [99],
        italic: false,
        bold: false
      }
    ]
    const positionChars = buildPositionChars(runs, glyphMap({ body: {} }))
    expect(positionChars.get(0)?.char).toBe('�')
  })

  it('carries run emphasis onto every character', () => {
    const runs: GlyphRun[] = [
      {
        fontKey: 'it',
        startPositionId: 5,
        glyphIds: [1],
        italic: true,
        bold: false
      }
    ]
    const positionChars = buildPositionChars(runs, glyphMap({ it: { 1: 'y' } }))
    expect(positionChars.get(5)).toStrictEqual({
      char: 'y',
      italic: true,
      bold: false
    })
  })
})

describe('reconstructPageText', () => {
  const runs: GlyphRun[] = [
    {
      fontKey: 'body',
      startPositionId: 100,
      glyphIds: [1, 2, 3, 3, 4],
      italic: false,
      bold: false
    },
    {
      fontKey: 'body',
      startPositionId: 106,
      glyphIds: [5, 4, 6, 3, 7],
      italic: false,
      bold: false
    },
    {
      fontKey: 'it',
      startPositionId: 200,
      glyphIds: [1, 2, 3],
      italic: true,
      bold: false
    }
  ]
  const map = glyphMap({
    body: { 1: 'H', 2: 'e', 3: 'l', 4: 'o', 5: 'W', 6: 'r', 7: 'd' },
    it: { 1: 'y', 2: 'e', 3: 's' }
  })

  it('reconstructs headings, words, spaces and emphasis', () => {
    const positionChars = buildPositionChars(runs, map)
    const page: LayoutPage = {
      startPositionId: 100,
      endPositionId: 202,
      paragraphs: [
        {
          headingLevel: 1,
          words: [{ startPositionId: 100, endPositionId: 104 }]
        },
        {
          headingLevel: undefined,
          words: [
            { startPositionId: 106, endPositionId: 110 },
            { startPositionId: 200, endPositionId: 202 }
          ]
        }
      ]
    }

    expect(reconstructPageText(page, positionChars)).toBe(
      '# Hello\n\nWorld *yes*'
    )
  })

  it('groups adjacent same-emphasis words under one marker', () => {
    const boldRuns: GlyphRun[] = [
      {
        fontKey: 'body',
        startPositionId: 0,
        glyphIds: [1, 2],
        italic: false,
        bold: true
      },
      {
        fontKey: 'body',
        startPositionId: 3,
        glyphIds: [1, 2],
        italic: false,
        bold: true
      }
    ]
    const boldMap = glyphMap({ body: { 1: 'h', 2: 'i' } })
    const positionChars = buildPositionChars(boldRuns, boldMap)
    const page: LayoutPage = {
      startPositionId: 0,
      endPositionId: 4,
      paragraphs: [
        {
          headingLevel: undefined,
          words: [
            { startPositionId: 0, endPositionId: 1 },
            { startPositionId: 3, endPositionId: 4 }
          ]
        }
      ]
    }
    expect(reconstructPageText(page, positionChars)).toBe('**hi hi**')
  })
})
