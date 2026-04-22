export function parsePositiveInt(
  raw: unknown,
  flag: string
): number | undefined {
  if (raw === undefined || raw === '') return undefined
  if (typeof raw === 'string' && !/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${flag} must be a positive integer (got "${String(raw)}")`)
  }

  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(`${flag} must be a positive integer (got "${String(raw)}")`)
  }

  return n
}
