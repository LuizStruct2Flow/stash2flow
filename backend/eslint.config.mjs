import tseslint from 'typescript-eslint'
import { layers } from './eslint.layers.mjs'

export default tseslint.config(
  // lint-fixtures/ holds the deliberately wrong examples the layering test lints itself.
  { ignores: ['node_modules/', 'reports/', 'lint-fixtures/'] },
  ...tseslint.configs.recommended,
  ...layers,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
)
