import { describe, expect, test } from 'vitest'

import { cleanupOcrText } from './text-cleanup'

describe('cleanupOcrText', () => {
  test('removes a standalone page number line', () => {
    expect(cleanupOcrText('Title\n  12  \nBody')).toBe('Title\nBody')
  })

  test('trims each OCR line', () => {
    expect(cleanupOcrText('  first line  \n\tsecond line\t')).toBe(
      'first line\nsecond line'
    )
  })

  test('keeps page-like numbers that are part of text', () => {
    expect(cleanupOcrText('Chapter 12\nBody')).toBe('Chapter 12\nBody')
  })
})
