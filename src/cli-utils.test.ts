import { describe, expect, test } from 'vitest'

import { formatCliValue, parsePositiveInt } from './cli-utils'

describe('formatCliValue', () => {
  test('formats primitive CLI values', () => {
    expect(formatCliValue('raw')).toBe('raw')
    expect(formatCliValue(null)).toBe('null')
    expect(formatCliValue(undefined)).toBe('undefined')
    expect(formatCliValue(42)).toBe('42')
    expect(formatCliValue(false)).toBe('false')
    expect(formatCliValue(10n)).toBe('10')
    expect(formatCliValue(Symbol.for('flag'))).toBe('Symbol(flag)')
  })

  test('formats objects as JSON when possible', () => {
    expect(formatCliValue({ limit: 2, mode: 'fast' })).toBe(
      '{"limit":2,"mode":"fast"}'
    )
  })

  test('falls back to object tags when JSON serialization is unavailable', () => {
    const objectWithUndefinedJson = {
      toJSON: () => new Map<string, unknown>().get('missing')
    }
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(formatCliValue(objectWithUndefinedJson)).toBe('[object Object]')
    expect(formatCliValue(circular)).toBe('[object Object]')
  })

  test('formats named and anonymous functions', () => {
    function namedFlagParser(): boolean {
      return true
    }

    const anonymous = function (): boolean {
      return false
    }
    Object.defineProperty(anonymous, 'name', { value: '' })

    expect(formatCliValue(namedFlagParser)).toBe('[function namedFlagParser]')
    expect(formatCliValue(anonymous)).toBe('[function]')
  })
})

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
