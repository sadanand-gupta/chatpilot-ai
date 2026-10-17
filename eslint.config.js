// ESLint flat config for the whole monorepo (ESLint 9).
// Workspace `lint` scripts run `eslint src` from each app; ESLint walks up and
// finds this file. Written as CommonJS because the root package.json has no
// "type": "module" (rename to eslint.config.mjs + `import` if that changes).
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');
const globals = require('globals');
const { defineConfig, globalIgnores } = require('eslint/config');

module.exports = defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/.data/**',
    '**/.data-*/**',
    'playwright-report/**',
    'test-results/**',
    '**/*.min.js',
  ]),

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Pragmatic defaults for every file.
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-unused-expressions': ['warn', { allowShortCircuit: true, allowTernary: true }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-control-regex': 'off', // crawler/sanitizer regexes intentionally match control chars
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
    },
  },

  // Browser code: dashboard + widget.
  {
    files: ['apps/web/**/*.{ts,tsx,js,jsx}', 'apps/widget/**/*.{ts,js}'],
    languageOptions: { globals: { ...globals.browser } },
  },

  // React hooks rules for the dashboard only.
  {
    files: ['apps/web/**/*.{ts,tsx,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Tests (unit + e2e) may be looser.
  {
    files: ['**/*.{test,spec}.{ts,tsx}', 'tests/**/*.ts', '**/test/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // CommonJS config files (this file, etc.).
  {
    files: ['**/*.cjs', 'eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);
