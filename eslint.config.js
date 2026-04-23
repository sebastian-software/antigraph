import { globalIgnores } from 'eslint/config'
import {
  configureRule,
  disableRule,
  getEslintConfig
} from 'eslint-config-setup'

const config = await getEslintConfig({ node: true })

for (const rule of [
  '@cspell/spellchecker',
  '@typescript-eslint/no-explicit-any',
  '@typescript-eslint/no-non-null-assertion',
  '@typescript-eslint/no-unsafe-argument',
  '@typescript-eslint/no-unsafe-assignment',
  '@typescript-eslint/no-unsafe-call',
  '@typescript-eslint/no-unsafe-member-access',
  '@typescript-eslint/no-unnecessary-condition',
  '@typescript-eslint/no-unnecessary-type-parameters',
  '@typescript-eslint/strict-boolean-expressions',
  '@typescript-eslint/strict-void-return',
  'complexity',
  'max-lines',
  'max-lines-per-function',
  'max-nested-callbacks',
  'max-statements',
  'node/hashbang',
  'perfectionist/sort-imports',
  'perfectionist/sort-exports',
  'perfectionist/sort-intersection-types',
  'perfectionist/sort-union-types',
  'regexp/no-useless-assertions',
  'regexp/no-useless-flag',
  'regexp/no-super-linear-move',
  'regexp/strict',
  'security/detect-non-literal-fs-filename',
  'sonarjs/cognitive-complexity',
  'vitest/prefer-strict-equal',
  'vitest/require-to-throw-message'
]) {
  disableRule(config, rule)
}

configureRule(config, 'unicorn/no-useless-undefined', [
  { checkArguments: false, checkArrowFunctionBody: true }
])

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
  ...config
]
