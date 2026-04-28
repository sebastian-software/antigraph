import { describe, expect, test } from 'vitest'

import {
  assert,
  dehyphenateAcrossPages,
  deromanize,
  escapeRegExp,
  hashObject,
  normalizeAuthors,
  normalizeBookMetadata,
  parseJsonpResponse,
  parsePageLabel
} from './utils'

describe('assert', () => {
  test('passes on truthy values', () => {
    expect(() => {
      assert(true)
    }).not.toThrow()
    expect(() => {
      assert(1)
    }).not.toThrow()
    expect(() => {
      assert('x')
    }).not.toThrow()
    expect(() => {
      assert(true)
    }).not.toThrow()
  })

  test('throws with default message on falsy values', () => {
    expect(() => {
      assert(false)
    }).toThrow('Assertion failed')
    expect(() => {
      assert(0)
    }).toThrow('Assertion failed')
    expect(() => {
      assert('')
    }).toThrow('Assertion failed')
  })

  test('throws with custom string message', () => {
    expect(() => {
      assert(false, 'boom')
    }).toThrow('boom')
  })

  test('throws provided Error instance unchanged', () => {
    const err = new TypeError('specific')
    expect(() => {
      assert(false, err)
    }).toThrow(err)
  })
})

describe('escapeRegExp', () => {
  test('escapes regex metacharacters for literal matching', () => {
    expect(escapeRegExp('C++ (Intro)? [v1]')).toBe(
      'C\\+\\+ \\(Intro\\)\\? \\[v1\\]'
    )
  })
})

describe('deromanize', () => {
  test('handles single-letter numerals', () => {
    expect(deromanize('I')).toBe(1)
    expect(deromanize('V')).toBe(5)
    expect(deromanize('X')).toBe(10)
    expect(deromanize('L')).toBe(50)
    expect(deromanize('C')).toBe(100)
    expect(deromanize('D')).toBe(500)
    expect(deromanize('M')).toBe(1000)
  })

  test('handles subtractive combinations', () => {
    expect(deromanize('IV')).toBe(4)
    expect(deromanize('IX')).toBe(9)
    expect(deromanize('XL')).toBe(40)
    expect(deromanize('XC')).toBe(90)
    expect(deromanize('CD')).toBe(400)
    expect(deromanize('CM')).toBe(900)
  })

  test('handles multi-digit numerals', () => {
    expect(deromanize('XIV')).toBe(14)
    expect(deromanize('XXVII')).toBe(27)
    expect(deromanize('MCMXC')).toBe(1990)
    expect(deromanize('MMXXV')).toBe(2025)
  })

  test('accepts lowercase (common in Kindle location labels)', () => {
    expect(deromanize('xiv')).toBe(14)
    expect(deromanize('xxvii')).toBe(27)
  })
})

describe('parseJsonpResponse', () => {
  test('extracts JSON payload wrapped in a callback', () => {
    const body = 'cb({"title":"Foo","pages":42})'
    expect(parseJsonpResponse(body)).toStrictEqual({ title: 'Foo', pages: 42 })
  })

  test('returns undefined when no JSONP wrapper is present', () => {
    expect(parseJsonpResponse('{"title":"Foo"}')).toBeUndefined()
    expect(parseJsonpResponse('plain text')).toBeUndefined()
    expect(parseJsonpResponse('')).toBeUndefined()
  })

  test('returns undefined when JSON inside wrapper is malformed', () => {
    expect(parseJsonpResponse('cb({not json})')).toBeUndefined()
  })

  test('returns the parsed JSON payload', () => {
    expect(parseJsonpResponse('cb({"a":1})')).toStrictEqual({ a: 1 })
  })
})

describe('normalizeAuthors', () => {
  test('returns empty array for empty input', () => {
    expect(normalizeAuthors([])).toStrictEqual([])
  })

  test('reverses "Last, First" into "First Last"', () => {
    expect(normalizeAuthors(['Reynolds, Alastair'])).toStrictEqual([
      'Alastair Reynolds'
    ])
  })

  test('splits colon-separated author lists', () => {
    expect(
      normalizeAuthors(['Reynolds, Alastair:Banks, Iain M.'])
    ).toStrictEqual(['Alastair Reynolds', 'Iain M. Banks'])
  })

  test('deduplicates repeated authors', () => {
    expect(
      normalizeAuthors(['Reynolds, Alastair:Reynolds, Alastair'])
    ).toStrictEqual(['Alastair Reynolds'])
  })

  test('handles single-name authors (no comma)', () => {
    expect(normalizeAuthors(['Homer'])).toStrictEqual(['Homer'])
  })
})

describe('hashObject', () => {
  test('produces stable sha1 hex digests', () => {
    const hash = hashObject({ a: 1, b: 2 })
    expect(hash).toMatch(/^[0-9a-f]{40}$/)
  })

  test('is deterministic for equal inputs', () => {
    expect(hashObject({ a: 1, b: 2 })).toBe(hashObject({ a: 1, b: 2 }))
  })

  test('is order-independent for keys', () => {
    expect(hashObject({ a: 1, b: 2 })).toBe(hashObject({ b: 2, a: 1 }))
  })

  test('differs for different values', () => {
    expect(hashObject({ a: 1 })).not.toBe(hashObject({ a: 2 }))
  })
})

describe('normalizeBookMetadata', () => {
  test('sorts known fields into canonical order', () => {
    const input = {
      pages: [] as never[],
      meta: { asin: 'X' } as never,
      toc: [] as never[],
      info: {} as never
    }
    const keys = Object.keys(normalizeBookMetadata(input))
    expect(keys).toStrictEqual(['meta', 'info', 'toc', 'pages'])
  })

  test('places unknown fields after known ones', () => {
    const input = {
      unknown: true,
      meta: {} as never,
      pages: [] as never[]
    } as unknown as Parameters<typeof normalizeBookMetadata>[0]
    const keys = Object.keys(normalizeBookMetadata(input))
    expect(keys.indexOf('meta')).toBeLessThan(keys.indexOf('unknown'))
    expect(keys.indexOf('pages')).toBeLessThan(keys.indexOf('unknown'))
  })
})

describe('dehyphenateAcrossPages', () => {
  test('merges a word split by a hyphen at the page boundary', () => {
    const chunks = [
      { text: 'Er ging weiter und fort-' },
      { text: 'schreitet in die Nacht.' }
    ]
    dehyphenateAcrossPages(chunks)
    expect(chunks[0]!.text).toBe('Er ging weiter und fortschreitet')
    expect(chunks[1]!.text).toBe('in die Nacht.')
  })

  test('handles trailing whitespace/newline after the hyphen', () => {
    const chunks = [{ text: 'something\ninter-\n' }, { text: 'esting happens' }]
    dehyphenateAcrossPages(chunks)
    expect(chunks[0]!.text).toBe('something\ninteresting')
    expect(chunks[1]!.text).toBe('happens')
  })

  test('leaves compound hyphens after a single uppercase letter alone', () => {
    const chunks = [{ text: 'Bitte senden an E-' }, { text: 'Mail-Adresse.' }]
    dehyphenateAcrossPages(chunks)
    expect(chunks[0]!.text).toBe('Bitte senden an E-')
    expect(chunks[1]!.text).toBe('Mail-Adresse.')
  })

  test('does nothing when the page does not end with a hyphen', () => {
    const chunks = [
      { text: 'End of sentence.' },
      { text: 'New page starts here.' }
    ]
    dehyphenateAcrossPages(chunks)
    expect(chunks[0]!.text).toBe('End of sentence.')
    expect(chunks[1]!.text).toBe('New page starts here.')
  })

  test('does nothing when the next page does not start with a letter', () => {
    const chunks = [{ text: 'fragment-' }, { text: '(just punctuation)' }]
    dehyphenateAcrossPages(chunks)
    expect(chunks[0]!.text).toBe('fragment-')
    expect(chunks[1]!.text).toBe('(just punctuation)')
  })

  test('handles German umlauts via Unicode letter classes', () => {
    const chunks = [{ text: 'zusammen-' }, { text: 'hängend und stark' }]
    dehyphenateAcrossPages(chunks)
    expect(chunks[0]!.text).toBe('zusammenhängend')
    expect(chunks[1]!.text).toBe('und stark')
  })

  test('processes multiple boundaries in one pass', () => {
    const chunks = [
      { text: 'page one with fort-' },
      { text: 'schritt, then ends with sub-' },
      { text: 'stanz to continue' }
    ]
    dehyphenateAcrossPages(chunks)
    expect(chunks[0]!.text).toBe('page one with fortschritt')
    expect(chunks[1]!.text).toBe(', then ends with substanz')
    expect(chunks[2]!.text).toBe('to continue')
  })
})

describe('parsePageLabel', () => {
  test('parses arabic page numbers', () => {
    expect(parsePageLabel('1')).toBe(1)
    expect(parsePageLabel('42')).toBe(42)
    expect(parsePageLabel('300')).toBe(300)
  })

  test('parses roman numerals (lowercase and uppercase)', () => {
    expect(parsePageLabel('iv')).toBe(4)
    expect(parsePageLabel('IV')).toBe(4)
    expect(parsePageLabel('xiv')).toBe(14)
    expect(parsePageLabel('MCMXC')).toBe(1990)
  })

  test('returns NaN for empty or whitespace input', () => {
    expect(parsePageLabel('')).toBeNaN()
    expect(parsePageLabel('   ')).toBeNaN()
  })

  test('returns NaN for malformed labels', () => {
    expect(parsePageLabel('1a')).toBeNaN()
    expect(parsePageLabel('page 4')).toBeNaN()
    expect(parsePageLabel('iv-a')).toBeNaN()
    expect(parsePageLabel('abc')).toBeNaN()
  })

  test('does not accept leading-zero arabic labels', () => {
    // "007" would parseInt to 7 but String(7) !== "007" — reject to avoid
    // masking labels like positional IDs being mistaken for pages.
    expect(parsePageLabel('007')).toBeNaN()
  })

  test('trims whitespace', () => {
    expect(parsePageLabel('  42  ')).toBe(42)
    expect(parsePageLabel('\tiv\n')).toBe(4)
  })
})
