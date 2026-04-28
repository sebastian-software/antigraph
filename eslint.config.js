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
  'max-lines-per-function',
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
  'vitest/prefer-strict-equal',
  'vitest/require-to-throw-message'
]) {
  disableRule(config, rule)
}

configureRule(config, 'unicorn/no-useless-undefined', [
  { checkArguments: false, checkArrowFunctionBody: true }
])
configureRule(config, 'complexity', [20])
configureRule(config, 'max-statements', [40])
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
  ...config
]
