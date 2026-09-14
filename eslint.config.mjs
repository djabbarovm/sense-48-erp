import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/coverage/**', '**/*.config.*', '**/next-env.d.ts', '**/playwright-report/**', '**/test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSTypeReference[typeName.name='Number'] ~ *",
          message: 'Use Money (minor units, bigint) for monetary values, never float.',
        },
      ],
    },
  },
  {
    // A-09: запрет hardcoded русских строк в JSX — все строки через next-intl
    files: ['apps/web/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXText[value=/[А-Яа-яЁё]/]',
          message: 'Hardcoded UI string: используйте next-intl словарь (A-09).',
        },
        {
          selector: 'JSXAttribute > Literal[value=/[А-Яа-яЁё]/]',
          message: 'Hardcoded UI string: используйте next-intl словарь (A-09).',
        },
      ],
    },
  },
  prettier,
);
