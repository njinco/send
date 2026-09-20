import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import mocha from 'eslint-plugin-mocha';
import n from 'eslint-plugin-n';
import security from 'eslint-plugin-security';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'assets/**',
      'firefox/**',
      'coverage/**',
      'android/app/build/**',
      'android/app/src/main/assets/**',
      'app/locale.js',
      'app/capabilities.js',
      'app/qrcode.js'
    ]
  },
  js.configs.recommended,
  n.configs['flat/recommended-script'],
  {
    files: ['**/*.js'],
    plugins: { security },
    languageOptions: {
      ecmaVersion: 2021,
      globals: globals.node,
      sourceType: 'commonjs'
    },
    rules: {
      'n/no-deprecated-api': 'off',
      'n/no-unsupported-features/es-syntax': 'off',
      'n/no-unsupported-features/node-builtins': 'off',
      'n/no-unpublished-require': 'off',
      'n/no-unpublished-import': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_|err|event|next|reject',
          caughtErrorsIgnorePattern: '^_|e|err|error|event|next|reject'
        }
      ],
      'require-atomic-updates': 'warn',
      // These rules were introduced after the repository's ESLint 6 baseline.
      'no-constant-binary-expression': 'off',
      'no-redeclare': ['error', { builtinGlobals: false }],
      'no-setter-return': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off'
    }
  },
  {
    files: ['app/**/*.js', 'test/frontend/**/*.js', 'android/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      sourceType: 'module'
    }
  },
  {
    files: ['scripts/**/*.js'],
    rules: {
      'n/hashbang': 'off',
      'security/detect-child-process': 'off',
      'no-console': 'off',
      'n/no-process-exit': 'off'
    }
  },
  {
    files: ['test/**/*.js'],
    plugins: { mocha },
    languageOptions: { globals: globals.mocha },
    rules: {
      'n/no-unpublished-require': 'off',
      'mocha/handle-done-callback': 'error',
      'mocha/no-exclusive-tests': 'error',
      'mocha/no-identical-title': 'warn',
      'mocha/no-mocha-arrows': 'error',
      'mocha/no-nested-tests': 'error',
      'mocha/no-pending-tests': 'error',
      'mocha/no-return-and-done': 'warn',
      'mocha/no-setup-in-suite': 'off',
      'mocha/no-hooks-for-single-child': 'off',
      'no-console': 'off'
    }
  },
  {
    files: ['test/integration/**/*.js'],
    // The legacy integration suite contains an intentionally pending browser test.
    rules: { 'mocha/no-pending-tests': 'off' }
  },
  {
    files: ['eslint.config.mjs'],
    languageOptions: { globals: globals.node, sourceType: 'module' }
  },
  {
    linterOptions: { reportUnusedDisableDirectives: 'off' }
  },
  prettier
];
