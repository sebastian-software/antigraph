import { globalIgnores } from 'eslint/config'
import { disableRule, getEslintConfig } from 'eslint-config-setup'

const config = await getEslintConfig({ node: true })

for (const rule of [
  '@cspell/spellchecker',
  '@typescript-eslint/no-base-to-string',
  '@typescript-eslint/no-confusing-void-expression',
  '@typescript-eslint/no-empty-function',
  '@typescript-eslint/no-explicit-any',
  '@typescript-eslint/no-floating-promises',
  '@typescript-eslint/no-non-null-assertion',
  '@typescript-eslint/no-redundant-type-constituents',
  '@typescript-eslint/no-shadow',
  '@typescript-eslint/no-unsafe-argument',
  '@typescript-eslint/no-unsafe-assignment',
  '@typescript-eslint/no-unsafe-call',
  '@typescript-eslint/no-unsafe-member-access',
  '@typescript-eslint/no-unnecessary-condition',
  '@typescript-eslint/no-unnecessary-type-assertion',
  '@typescript-eslint/no-unnecessary-type-conversion',
  '@typescript-eslint/no-unnecessary-type-parameters',
  '@typescript-eslint/array-type',
  '@typescript-eslint/consistent-type-definitions',
  '@typescript-eslint/prefer-nullish-coalescing',
  '@typescript-eslint/prefer-promise-reject-errors',
  '@typescript-eslint/prefer-reduce-type-parameter',
  '@typescript-eslint/prefer-regexp-exec',
  '@typescript-eslint/require-await',
  '@typescript-eslint/strict-boolean-expressions',
  '@typescript-eslint/strict-void-return',
  '@typescript-eslint/use-unknown-in-catch-callback-variable',
  'complexity',
  'max-depth',
  'max-lines',
  'max-lines-per-function',
  'max-nested-callbacks',
  'max-params',
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
  'unicorn/catch-error-name',
  'unicorn/no-array-callback-reference',
  'unicorn/no-useless-undefined',
  'unicorn/prefer-spread',
  'vitest/prefer-strict-equal',
  'vitest/require-to-throw-message'
]) {
  disableRule(config, rule)
}

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
