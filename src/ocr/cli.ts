import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { OcrBackend, OcrRequest } from './types'

import { OCR_PROMPTS } from './prompts'

/**
 * Vision backend that shells out to an installed agentic coding CLI — Codex
 * (`codex exec -i <image>`) or Claude Code (`claude -p`) — instead of a local
 * model server. Convenient for the single glyph-grid labelling call per book:
 * no Ollama/MLX setup, and the underlying frontier models read a grid of
 * isolated glyphs very reliably (ligatures included). Only anonymous font
 * glyphs are ever sent, never book text.
 */

export type CliTool = 'claude' | 'codex'

export type CliBackendOptions = {
  /** Full override of the prompt (e.g. the glyph-grid labelling prompt). */
  prompt?: string
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  return 'png'
}

async function runCli(
  command: string,
  args: string[],
  input: string | undefined
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(
          new Error(`${command} exited with ${code}: ${stderr.slice(0, 500)}`)
        )
      }
    })
    if (input !== undefined) {
      child.stdin.write(input)
      child.stdin.end()
    }
  })
}

export function createCliBackend(
  cli: CliTool,
  options: CliBackendOptions = {}
): OcrBackend {
  return {
    name: `cli:${cli}`,
    async transcribe({ imageBuffer, mimeType, format = 'plain' }: OcrRequest) {
      const prompt = options.prompt ?? OCR_PROMPTS[format]
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'antigraph-cli-'))
      const imagePath = path.join(dir, `input.${extensionForMime(mimeType)}`)
      try {
        await fs.writeFile(imagePath, imageBuffer)
        if (cli === 'codex') {
          return await runCli(
            'codex',
            ['exec', '--skip-git-repo-check', '-i', imagePath],
            prompt
          )
        }
        return await runCli(
          'claude',
          ['-p', `${prompt}\n\nThe image to read is at: ${imagePath}`],
          undefined
        )
      } finally {
        await fs.rm(dir, { recursive: true, force: true })
      }
    }
  }
}
