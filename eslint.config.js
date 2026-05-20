// @ts-check
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    ignores: ['node_modules/', 'dist/', '.next/', 'db/migrations/'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
      'func-style': ['error', 'expression', { allowArrowFunctions: true }],
      'no-console': 'error',
    },
  },
  {
    // Next.js page/layout files use default exports
    files: ['apps/*/src/app/**/*.tsx', 'apps/*/src/app/**/*.ts'],
    rules: {
      'func-style': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    // Config files and scripts at root level
    files: ['*.cjs', '*.config.*'],
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
];
