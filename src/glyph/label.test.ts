import { describe, expect, it } from 'vitest'

import { parseGridLabels } from './label'

describe('parseGridLabels', () => {
  it('parses a plain JSON reply into cellIndex → character', () => {
    const labels = parseGridLabels('{"0":"a","1":"T","2":"fi"}')
    expect(labels.get(0)).toBe('a')
    expect(labels.get(1)).toBe('T')
    expect(labels.get(2)).toBe('fi')
  })

  it('tolerates code fences and surrounding prose', () => {
    const labels = parseGridLabels(
      'Here you go:\n```json\n{"0":"x","1":"y"}\n```\nDone.'
    )
    expect(labels.get(0)).toBe('x')
    expect(labels.get(1)).toBe('y')
  })

  it('skips non-string and empty values', () => {
    const labels = parseGridLabels('{"0":"a","1":null,"2":"","3":5,"4":"b"}')
    expect([...labels.entries()]).toStrictEqual([
      [0, 'a'],
      [4, 'b']
    ])
  })

  it('returns an empty map for unparseable input', () => {
    expect(parseGridLabels('sorry, I cannot').size).toBe(0)
    expect(parseGridLabels('').size).toBe(0)
  })
})
