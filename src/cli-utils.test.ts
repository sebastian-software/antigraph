import { describe, expect, test } from 'vitest'

import { parsePositiveInt } from './cli-utils'

describe('parsePositiveInt', () => {
  test('returns undefined for omitted values', () => {
    expect(parsePositiveInt(undefined, '--max-pages')).toBeUndefined()
    expect(parsePositiveInt('', '--max-pages')).toBeUndefined()
  })

  test('accepts positive integer strings and numbers', () => {
    expect(parsePositiveInt('1', '--max-pages')).toBe(1)
    expect(parsePositiveInt('42', '--max-pages')).toBe(42)
    expect(parsePositiveInt(7, '--max-pages')).toBe(7)
  })

  test('rejects non-integer and partially numeric strings', () => {
    expect(() => parsePositiveInt('1.5', '--max-pages')).toThrow(
      '--max-pages must be a positive integer'
    )
    expect(() => parsePositiveInt('10abc', '--max-pages')).toThrow(
      '--max-pages must be a positive integer'
    )
  })

  test('rejects zero, negative, and non-finite values', () => {
    expect(() => parsePositiveInt('0', '--timeout-ms')).toThrow(
      '--timeout-ms must be a positive integer'
    )
    expect(() => parsePositiveInt(-1, '--timeout-ms')).toThrow(
      '--timeout-ms must be a positive integer'
    )
    expect(() =>
      parsePositiveInt(Number.POSITIVE_INFINITY, '--timeout-ms')
    ).toThrow('--timeout-ms must be a positive integer')
  })
})
