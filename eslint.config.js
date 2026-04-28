import { globalIgnores } from 'eslint/config'
import {
  configureRule,
  disableRule,
  getEslintConfig
} from 'eslint-config-setup'

const config = await getEslintConfig({ node: true })

configureRule(config, 'unicorn/no-useless-undefined', [
  { checkArguments: false, checkArrowFunctionBody: true }
])
configureRule(config, 'complexity', [20])
configureRule(config, 'max-statements', [40])
configureRule(config, 'max-lines-per-function', [
  { max: 80, skipBlankLines: true, skipComments: true }
])
configureRule(config, 'sonarjs/cognitive-complexity', [20])

export default [
  globalIgnores([
    'coverage',
    'eslint.config.js',
    'out',
    'dist',
    '.venv-mlx',
    '.venv',
    '**/*.json',
    '**/*.md',
    '**/*.yaml',
    '**/*.yml'
  ]),
  ...config,
  // Antigraph is a local CLI that intentionally reads and writes user-selected
  // project paths. Keep the security rule enabled elsewhere, but opt out for
  // the IO boundary modules and tests where non-literal paths are expected.
  {
    files: [
      'scripts/smoke-pack.mjs',
      'src/**/*.test.ts',
      'src/assemble-chapters.ts',
      'src/cleanup-chapters.ts',
      'src/cli.ts',
      'src/compare-ocr-backends.ts',
      'src/export-book-markdown.ts',
      'src/extract-browser.ts',
      'src/extract-kindle-book.ts',
      'src/extract-network.ts',
      'src/extract-render.ts',
      'src/transcribe-book-content.ts',
      'src/utils.ts'
    ],
    rules: {
      'security/detect-non-literal-fs-filename': 'off'
    }
  }
]
