import { config } from '@fisch0920/config/eslint'
import { globalIgnores } from 'eslint/config'

export default [...config, globalIgnores(['out', 'dist', '.venv-mlx', '.venv'])]
