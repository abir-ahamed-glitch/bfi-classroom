import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'scratch_migration.js',
    'scratch_migration.cjs',
    'scratch.js',
    'scratch_test.js',
    'scratch_test_update.js',
    'test.js',
    'test.cjs',
    'test_helper.js',
    'test_insert.js',
    'test_insert.cjs',
    'test_student_profiles.js',
    'test_targeting.js',
    'test_users.js',
    'check.js',
    'check_error.cjs',
    'create-admin.js',
    'generate_html.cjs',
    'migrate.cjs',
    'schema.cjs',
    'tunnel.js'
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node
      },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z_]' }],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
])
