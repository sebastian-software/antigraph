import { describe, expect, test } from 'vitest'

import {
  cleanChapterText,
  mergeSplitParagraphs,
  normalizeWhitespace,
  stripChapterHeading
} from './chapter-cleanup'

describe('stripChapterHeading', () => {
  test('strips single-line heading when it matches the title', () => {
    const text = 'The Audience\nSoon after you confront the matter…'
    expect(stripChapterHeading(text, '5. The Audience')).toBe(
      'Soon after you confront the matter…'
    )
  })

  test('strips colon-split heading across two lines', () => {
    const text =
      'Writing About People\nThe Interview\nGet people talking. Learn…'
    const out = stripChapterHeading(
      text,
      '12. Writing About People: The Interview'
    )
    expect(out).toBe('Get people talking. Learn…')
  })

  test('strips Part-style heading with subtitle', () => {
    const text = 'Part II\nMethods\n'
    expect(stripChapterHeading(text, 'Part II: Methods')).toBe('')
  })

  test('ignores numeric prefix on the title when matching', () => {
    const text = 'Clutter\nbody…'
    expect(stripChapterHeading(text, '3. Clutter')).toBe('body…')
  })

  test('no-op when the heading is not present', () => {
    const text = 'Fighting clutter is like fighting weeds…'
    expect(stripChapterHeading(text, '3. Clutter')).toBe(text)
  })

  test('no-op when title is blank', () => {
    expect(stripChapterHeading('body', '')).toBe('body')
    expect(stripChapterHeading('body', '  1.  ')).toBe('body')
  })

  test('falls back to full title if colon-split does not match', () => {
    // Sometimes a chapter titled "A: B" has the whole thing on one line.
    const text = 'Writing About People: The Interview\nGet people talking.'
    expect(
      stripChapterHeading(text, '12. Writing About People: The Interview')
    ).toBe('Get people talking.')
  })
})

describe('normalizeWhitespace', () => {
  test('normalizes CRLF to LF', () => {
    expect(normalizeWhitespace('a\r\nb\rc')).toBe('a\nb\nc')
  })

  test('trims trailing whitespace per line', () => {
    expect(normalizeWhitespace('foo  \nbar\t')).toBe('foo\nbar')
  })

  test('collapses 3+ consecutive newlines into 2', () => {
    expect(normalizeWhitespace('a\n\n\n\nb')).toBe('a\n\nb')
  })

  test('preserves paragraph breaks (exactly two newlines)', () => {
    expect(normalizeWhitespace('a\n\nb')).toBe('a\n\nb')
  })

  test('trims leading and trailing blank lines', () => {
    expect(normalizeWhitespace('\n\nfoo\n\nbar\n\n')).toBe('foo\n\nbar')
  })
})

describe('mergeSplitParagraphs', () => {
  test('merges paragraph ending in letter with next starting lowercase', () => {
    const input = 'It is worth bothering about. Writing\n\nimproves in ratio.'
    expect(mergeSplitParagraphs(input)).toBe(
      'It is worth bothering about. Writing improves in ratio.'
    )
  })

  test('merges across comma-ended continuation', () => {
    expect(mergeSplitParagraphs('we went,\n\nand he followed')).toBe(
      'we went, and he followed'
    )
  })

  test('keeps paragraphs separate when previous ends with period', () => {
    const input = 'First sentence.\n\nsecond sentence.'
    // Even though next starts lowercase, prev ended with a period → no merge.
    expect(mergeSplitParagraphs(input)).toBe(input)
  })

  test('keeps paragraphs separate when next starts capitalized', () => {
    const input = 'Writing\n\nImproves in ratio.'
    expect(mergeSplitParagraphs(input)).toBe(input)
  })

  test('keeps paragraphs separate when previous ends with punctuation', () => {
    expect(mergeSplitParagraphs('hello!\n\nworld')).toBe('hello!\n\nworld')
    expect(mergeSplitParagraphs('really?\n\nsure')).toBe('really?\n\nsure')
  })

  test('handles more than two split paragraphs', () => {
    const input = 'a\n\nb\n\nc'
    // a ends with letter, b starts lowercase → merge. Then merged ends 'b',
    // c starts lowercase → merge again.
    expect(mergeSplitParagraphs(input)).toBe('a b c')
  })

  test('drops empty paragraphs', () => {
    expect(mergeSplitParagraphs('a.\n\n\n\nb.')).toBe('a.\n\nb.')
  })
})

describe('cleanChapterText', () => {
  test('applies full pipeline: heading strip + whitespace + merge', () => {
    const text =
      'The Audience\r\n\r\nSoon after you confront the matter of preserving\n\nyour identity.'
    expect(cleanChapterText(text, '5. The Audience')).toBe(
      'Soon after you confront the matter of preserving your identity.'
    )
  })

  test('no-op on already-clean text', () => {
    const text = 'Paragraph one.\n\nParagraph two.'
    expect(cleanChapterText(text, '99. Ghost Chapter')).toBe(text)
  })

  test('returns empty string for part-title-only text', () => {
    expect(cleanChapterText('Part II\nMethods', 'Part II: Methods')).toBe('')
  })
})
