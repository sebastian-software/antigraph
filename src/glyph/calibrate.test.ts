import { describe, expect, it } from 'vitest'

import { clusterRasters } from './calibrate'

function raster(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes)
}

describe('clusterRasters', () => {
  it('groups near-identical rasters and separates distinct ones', () => {
    const clusters = clusterRasters([
      raster([0, 0, 0, 0]),
      raster([255, 255, 255, 255]),
      raster([2, 1, 0, 3]),
      raster([250, 255, 252, 255])
    ])

    expect(clusters).toHaveLength(2)
    const sizes = clusters
      .map((c) => c.memberIndices.length)
      .toSorted((a, b) => a - b)
    expect(sizes).toStrictEqual([2, 2])
  })

  it('averages members into the centroid', () => {
    const clusters = clusterRasters([raster([0, 0]), raster([10, 10])])
    // Both within the default budget → one cluster; centroid is the mean.
    expect(clusters).toHaveLength(1)
    expect([...(clusters[0]?.centroid ?? [])]).toStrictEqual([5, 5])
  })

  it('over-splits rather than merging when the threshold is tight', () => {
    const clusters = clusterRasters(
      [raster([0, 0, 0, 0]), raster([120, 120, 120, 120])],
      1 // near-zero budget → never merge
    )
    expect(clusters).toHaveLength(2)
  })

  it('ignores empty rasters', () => {
    const clusters = clusterRasters([raster([]), raster([0, 0])])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.memberIndices).toStrictEqual([1])
  })
})
