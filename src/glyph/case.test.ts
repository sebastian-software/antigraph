import { describe, expect, it } from 'vitest'

import { glyphAscent, resolveGlyphCase } from './case'

// Font design space is y-up: ascenders are negative y. Ascent is the magnitude
// of the most-negative y.
const CAP_PATH = 'M0,0 L0,-700 L400,-700 L400,0 Z' // reaches cap-height
const X_HEIGHT_PATH = 'M0,0 L0,-500 L400,-500 L400,0 Z' // reaches x-height only

describe('glyphAscent', () => {
  it('returns the height above the baseline in font units', () => {
    expect(glyphAscent(CAP_PATH)).toBe(700)
    expect(glyphAscent(X_HEIGHT_PATH)).toBe(500)
    expect(glyphAscent('')).toBe(0)
  })
})

describe('resolveGlyphCase', () => {
  it('upper-cases a tall shape-ambiguous letter', () => {
    expect(resolveGlyphCase('o', CAP_PATH, 1000)).toBe('O')
    expect(resolveGlyphCase('s', CAP_PATH, 1000)).toBe('S')
  })

  it('lower-cases a short shape-ambiguous letter', () => {
    expect(resolveGlyphCase('O', X_HEIGHT_PATH, 1000)).toBe('o')
    expect(resolveGlyphCase('v', X_HEIGHT_PATH, 1000)).toBe('v')
  })

  it('leaves non-ambiguous letters untouched', () => {
    expect(resolveGlyphCase('H', X_HEIGHT_PATH, 1000)).toBe('H')
    expect(resolveGlyphCase('e', CAP_PATH, 1000)).toBe('e')
    expect(resolveGlyphCase('k', X_HEIGHT_PATH, 1000)).toBe('k')
  })

  it('leaves ligatures and multi-character strings untouched', () => {
    expect(resolveGlyphCase('fi', CAP_PATH, 1000)).toBe('fi')
  })
})
