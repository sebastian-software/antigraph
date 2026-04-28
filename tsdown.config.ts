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
  plugins: [
    {
      name: 'antigraph-cli-shebang',
      renderChunk(code, chunk) {
        if (!chunk.fileName.endsWith('cli.js') || code.startsWith('#!')) {
          return null
        }

        return {
          code: `#!/usr/bin/env node\n${code}`,
          map: null
        }
      }
    }
  ]
})
