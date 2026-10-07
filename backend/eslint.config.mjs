import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['node_modules/', 'reports/'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
)
