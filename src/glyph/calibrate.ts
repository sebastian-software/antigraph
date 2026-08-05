/**
 * Self-calibration: build a clean glyph reference from the book's own rendered
 * glyphs, without any external font.
 *
 * Amazon jitters every glyph's outline per render chunk, but the same character
 * still rasterizes to nearly the same image. Greedy online clustering groups
 * those near-identical rasters; each cluster's running mean is a denoised
 * template. The clusters are then labelled once (see the transcriber) and every
 * book glyph matched against them.
 *
 * The threshold is deliberately tight: it is far cheaper to *over-split* (the
 * same character lands in two clusters, both labelled correctly) than to
 * over-merge* (a cluster mixes two characters and mislabels one of them).
 */

/**
 * Per-pixel squared-difference budget. Two rasters join the same cluster when
 * their mean squared greyscale difference is below this. Tuned for
 * {@link ./rasterize.ts}'s raster size; scales with the pixel count.
 */
const DEFAULT_PER_PIXEL_THRESHOLD = 220

export type GlyphCluster = {
  /** Running mean of the member rasters — the denoised template. */
  centroid: Float64Array
  /** Indices into the input raster array that landed in this cluster. */
  memberIndices: number[]
}

function sumSquaredDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let total = 0
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    total += diff * diff
  }
  return total
}

type MutableCluster = {
  centroid: Float64Array
  sum: Float64Array
  memberIndices: number[]
}

function nearestClusterIndex(
  raster: Uint8Array,
  clusters: MutableCluster[]
): { index: number; distance: number } {
  let index = -1
  let distance = Number.POSITIVE_INFINITY
  for (const [i, cluster] of clusters.entries()) {
    const candidate = sumSquaredDiff(raster, cluster.centroid)
    if (candidate < distance) {
      distance = candidate
      index = i
    }
  }
  return { index, distance }
}

function addToCluster(
  cluster: MutableCluster,
  raster: Uint8Array,
  index: number
) {
  for (let i = 0; i < cluster.sum.length; i++) {
    cluster.sum[i] = (cluster.sum[i] ?? 0) + (raster[i] ?? 0)
  }
  cluster.memberIndices.push(index)
  const count = cluster.memberIndices.length
  for (let i = 0; i < cluster.sum.length; i++) {
    cluster.centroid[i] = (cluster.sum[i] ?? 0) / count
  }
}

/**
 * Cluster glyph rasters by shape. Same-size rasters are assumed (produced by
 * {@link ./rasterize.ts}). Returns one {@link GlyphCluster} per distinct shape,
 * biased toward over-splitting.
 */
export function clusterRasters(
  rasters: Uint8Array[],
  perPixelThreshold: number = DEFAULT_PER_PIXEL_THRESHOLD
): GlyphCluster[] {
  const clusters: MutableCluster[] = []

  for (const [index, raster] of rasters.entries()) {
    if (raster.length === 0) continue

    const threshold = perPixelThreshold * raster.length
    const { index: nearest, distance } = nearestClusterIndex(raster, clusters)
    const existing = nearest >= 0 ? clusters[nearest] : undefined

    if (existing !== undefined && distance < threshold) {
      addToCluster(existing, raster, index)
    } else {
      clusters.push({
        centroid: Float64Array.from(raster),
        sum: Float64Array.from(raster),
        memberIndices: [index]
      })
    }
  }

  return clusters.map((cluster) => ({
    centroid: cluster.centroid,
    memberIndices: cluster.memberIndices
  }))
}
