import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import tseslint from 'typescript-eslint'
import * as importX from 'eslint-plugin-import-x'
import newLines from 'eslint-plugin-import-newlines'

export default [
  {
    ignores: ['**/dist'],
  },
  js.configs.recommended,
  stylistic.configs.customize({
    braceStyle: '1tbs',
    indent: 2,
    quotes: 'single',
  }),
  ...tseslint.configs.strict,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    plugins: { 'import-newlines': newLines },
  },
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      '@stylistic/arrow-parens': ['error', 'as-needed'],
      '@stylistic/jsx-closing-bracket-location': 'off',
      '@stylistic/jsx-first-prop-new-line': 'off',
      '@stylistic/jsx-max-props-per-line': 'off',
      '@stylistic/member-delimiter-style': ['error', {
        multiline: { delimiter: 'comma', requireLast: true },
        singleline: { delimiter: 'comma', requireLast: false },
      }],
      '@stylistic/multiline-ternary': 'off',
      '@stylistic/operator-linebreak': 'off',
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports', prefer: 'type-imports' }],
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^ignore' }],
      'import-newlines/enforce': ['error', 20, 120],
      'import-x/default': 'off',
      'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
      'import-x/no-named-as-default-member': 'off',
      'prefer-const': ['error', { destructuring: 'all' }],
      'sort-imports': ['error', { ignoreCase: true, ignoreDeclarationSort: true }],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
]
