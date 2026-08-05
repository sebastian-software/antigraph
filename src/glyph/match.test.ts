import { describe, expect, it } from 'vitest'

import { type GlyphReference, nearestReference } from './match'

function ref(label: string, bytes: number[]): GlyphReference {
  return { label, raster: new Uint8Array(bytes) }
}

describe('nearestReference', () => {
  const references = [
    ref('a', [0, 0, 255, 255]),
    ref('b', [255, 255, 0, 0]),
    ref('c', [0, 255, 0, 255])
  ]

  it('returns the closest reference by squared difference', () => {
    const target = new Uint8Array([10, 0, 245, 255])
    expect(nearestReference(target, references).label).toBe('a')
  })

  it('reports an exact match as an infinite margin', () => {
    const target = new Uint8Array([255, 255, 0, 0])
    const result = nearestReference(target, references)
    expect(result.label).toBe('b')
    expect(result.margin).toBe(Number.POSITIVE_INFINITY)
  })

  it('reports a small margin when two references are similarly close', () => {
    const near = [ref('x', [0, 0, 0, 0]), ref('y', [0, 0, 0, 10])]
    const result = nearestReference(new Uint8Array([0, 0, 0, 5]), near)
    // Both references are equidistant → margin 1 (a tie).
    expect(result.margin).toBe(1)
  })

  it('falls back to the replacement char for an empty reference set', () => {
    expect(nearestReference(new Uint8Array([1, 2]), []).label).toBe('�')
  })
})
