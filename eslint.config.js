import eslint from '@eslint/js';
import globals from 'globals';

export default [
  eslint.configs.recommended,
  {
    files: ['apps/web/public/js/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.browser },
    rules: {
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-undef': 'error',
    },
  },
  {
    files: ['apps/web/src/**/*.js', 'server.js', 'scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }], 'no-empty': 'off' },
  },
  { ignores: ['node_modules/**', 'output/**', 'graphify-out/**'] },
];
