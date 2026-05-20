// @ts-check
'use strict';

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended-type-checked'],
  rules: {
    // No any without explicit justification
    '@typescript-eslint/no-explicit-any': 'error',

    // Enforce arrow functions for top-level exports (classes allowed for stateful code)
    'func-style': ['error', 'expression', { allowArrowFunctions: true }],

    // No console — use Pino
    'no-console': 'error',

    // No unused vars
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

    // No floating promises
    '@typescript-eslint/no-floating-promises': 'error',

    // Enforce explicit return types on exported functions
    '@typescript-eslint/explicit-module-boundary-types': 'warn',
  },
  overrides: [
    {
      // Next.js page/layout files use default exports
      files: ['apps/*/src/app/**/*.tsx', 'apps/*/src/app/**/*.ts'],
      rules: {
        'func-style': 'off',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
      },
    },
    {
      // Config files and scripts at root level use CommonJS
      files: ['*.cjs', '*.config.*'],
      env: { node: true },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
  ignorePatterns: ['node_modules/', 'dist/', '.next/', 'db/migrations/'],
};
