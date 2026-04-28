import { globalIgnores } from 'eslint/config'
import {
  configureRule,
  disableRule,
  getEslintConfig
} from 'eslint-config-setup'

const config = await getEslintConfig({ node: true })

for (const rule of [
  '@cspell/spellchecker',
  '@typescript-eslint/no-non-null-assertion',
  '@typescript-eslint/no-unsafe-argument',
  '@typescript-eslint/no-unsafe-call',
  '@typescript-eslint/no-unnecessary-condition',
  '@typescript-eslint/strict-boolean-expressions',
  'security/detect-non-literal-fs-filename'
]) {
  disableRule(config, rule)
}

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
  ...config
]
