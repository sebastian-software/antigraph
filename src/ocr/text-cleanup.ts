function isStandalonePageNumber(line: string): boolean {
  const value = line.trim()
  if (value.length === 0) return false

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 48 || code > 57) return false
  }

  return true
}

function stripStandalonePageNumberLine(text: string): string {
  const lines = text.split('\n')
  const index = lines.findIndex((line) => isStandalonePageNumber(line))
  if (index === -1) return text

  return [...lines.slice(0, index), ...lines.slice(index + 1)].join('\n')
}

export function cleanupOcrText(text: string): string {
  return stripStandalonePageNumberLine(text)
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
}
