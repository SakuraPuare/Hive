import next from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = [
  ...next,
  ...nextTs,
  {
    // React Compiler-era advisory rules (eslint-plugin-react-hooks v6) fire on
    // the common "load data inside an effect" idiom used throughout this app.
    // Keep them as warnings rather than hard errors.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/incompatible-library': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Tests rely on `any` for lightweight mocks and partial fixtures.
    files: ['__tests__/**', 'test/**', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: [
      'src/generated/**',
      'out/**',
      '.next/**',
      'node_modules/**',
    ],
  },
];

export default eslintConfig;
