import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'public-api': 'src/public-api.ts',
    cli: 'src/cli.ts'
  },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  dts: true,
  sourcemap: true,
  fixedExtension: false,
  hash: false,
  banner({ fileName }: { fileName: string }): { js: string } | undefined {
    if (fileName.endsWith('cli.js')) {
      return {
        js: '#!/usr/bin/env node'
      }
    }

    return undefined
  }
})
