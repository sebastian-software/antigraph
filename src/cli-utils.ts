export function formatCliValue(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw === null) return 'null'
  if (raw === undefined) return 'undefined'
  if (typeof raw === 'object') {
    try {
      const json = JSON.stringify(raw) as string | undefined
      return json ?? Object.prototype.toString.call(raw)
    } catch {
      return Object.prototype.toString.call(raw)
    }
  }
  if (typeof raw === 'function') {
    return raw.name ? `[function ${raw.name}]` : '[function]'
  }
  if (
    typeof raw === 'number' ||
    typeof raw === 'boolean' ||
    typeof raw === 'bigint' ||
    typeof raw === 'symbol'
  ) {
    return String(raw)
  }

  return 'unknown'
}

export function parsePositiveInt(
  raw: unknown,
  flag: string
): number | undefined {
  if (raw === undefined || raw === '') return undefined
  if (typeof raw === 'string' && !/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${flag} must be a positive integer (got "${raw}")`)
  }

  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(
      `${flag} must be a positive integer (got "${formatCliValue(raw)}")`
    )
  }

  return n
}
