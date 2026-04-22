import { describe, expect, test } from 'vitest'

import { createOcrBackend, OCR_ENGINES } from './index'

describe('createOcrBackend', () => {
  test('picks the ollama backend for engine=ollama', () => {
    const backend = createOcrBackend('ollama')
    expect(backend.name).toMatch(/^ollama:/)
  })

  test('picks the mlx backend for engine=mlx', () => {
    const backend = createOcrBackend('mlx')
    expect(backend.name).toMatch(/^mlx:/)
  })

  test('honours model override for ollama', () => {
    const backend = createOcrBackend('ollama', { model: 'qwen2.5vl' })
    expect(backend.name).toBe('ollama:qwen2.5vl')
  })

  test('honours model override for mlx', () => {
    const backend = createOcrBackend('mlx', {
      model: 'mlx-community/MonkeyOCR-3B'
    })
    expect(backend.name).toBe('mlx:mlx-community/MonkeyOCR-3B')
  })

  test('throws on unknown engines (including removed cloud backends)', () => {
    expect(() => createOcrBackend('mystery')).toThrow(/Unknown OCR engine/)
    expect(() => createOcrBackend('openai')).toThrow(/Unknown OCR engine/)
    expect(() => createOcrBackend('anthropic')).toThrow(/Unknown OCR engine/)
  })

  test('OCR_ENGINES enumerates exactly the two supported engines', () => {
    expect([...OCR_ENGINES]).toEqual(['ollama', 'mlx'])
  })
})
