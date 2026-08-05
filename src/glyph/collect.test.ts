import { describe, expect, it } from 'vitest'

import { collectLayoutPages, collectRuns, parseFonts } from './collect'

describe('parseFonts', () => {
  it('keeps path glyphs and drops js glyphs', () => {
    const fonts = parseFonts([
      {
        fontKey: 'bookerlyNormunknown',
        unitsPerEm: 1000,
        glyphs: {
          0: { type: 'path', path: 'M0,0 L1,1' },
          1: { type: 'js', code: 'noop()' }
        }
      }
    ])

    const font = fonts.get('bookerlyNormunknown')
    expect(font?.unitsPerEm).toBe(1000)
    expect(font?.glyphs.get(0)).toBe('M0,0 L1,1')
    expect(font?.glyphs.has(1)).toBe(false)
  })

  it('falls back to fontFamily when fontKey is absent', () => {
    const fonts = parseFonts([{ fontFamily: 'bookerly', glyphs: {} }])
    expect(fonts.has('bookerly')).toBe(true)
    expect(fonts.get('bookerly')?.unitsPerEm).toBe(1000)
  })
})

describe('collectRuns', () => {
  it('finds nested runs and derives italic/bold', () => {
    const runs = collectRuns([
      {
        type: 'page',
        children: [
          {
            type: 'run',
            fontKey: 'body',
            startPositionId: 100,
            glyphs: [1, 2, 3],
            fontStyle: 'normal',
            fontWeight: 400
          },
          {
            type: 'run',
            fontKey: 'ital',
            startPositionId: 200,
            glyphs: [4],
            fontStyle: 'italic',
            fontWeight: 700
          }
        ]
      }
    ])

    expect(runs).toHaveLength(2)
    expect(runs[0]).toMatchObject({
      fontKey: 'body',
      italic: false,
      bold: false
    })
    expect(runs[1]).toMatchObject({ fontKey: 'ital', italic: true, bold: true })
  })

  it('ignores non-run nodes', () => {
    expect(collectRuns([{ type: 'column', children: [] }])).toStrictEqual([])
  })
})

describe('collectLayoutPages', () => {
  it('builds page → paragraph → word with heading levels', () => {
    const pages = collectLayoutPages([
      {
        type: 'page',
        startPositionId: 10,
        endPositionId: 40,
        children: [
          {
            type: 'column',
            children: [
              {
                type: 'paragraph',
                headingLevel: 2,
                children: [
                  { type: 'word', startPositionId: 10, endPositionId: 14 }
                ]
              },
              {
                type: 'paragraph',
                children: [
                  { type: 'word', startPositionId: 16, endPositionId: 20 },
                  { type: 'word', startPositionId: 22, endPositionId: 25 }
                ]
              }
            ]
          }
        ]
      }
    ])

    expect(pages).toHaveLength(1)
    expect(pages[0]?.startPositionId).toBe(10)
    expect(pages[0]?.paragraphs[0]?.headingLevel).toBe(2)
    expect(pages[0]?.paragraphs[1]?.words).toHaveLength(2)
    expect(pages[0]?.paragraphs[1]?.words[0]).toStrictEqual({
      startPositionId: 16,
      endPositionId: 20
    })
  })
})
