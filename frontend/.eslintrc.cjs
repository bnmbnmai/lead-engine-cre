module.exports = {
    env: { browser: true, es2022: true },
    parser: '@typescript-eslint/parser',
    parserOptions: { sourceType: 'module', ecmaFeatures: { jsx: true } },
    plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
    ],
    rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        '@typescript-eslint/no-require-imports': 'off',
        '@typescript-eslint/no-namespace': 'warn',
        '@typescript-eslint/no-unused-expressions': 'warn',
        '@typescript-eslint/no-unsafe-function-type': 'warn',
        'react-hooks/rules-of-hooks': 'warn',
        'react-hooks/exhaustive-deps': 'warn',
        'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
        'no-console': 'off',
    },
    ignorePatterns: ['dist/', 'node_modules/', '*.js'],
};
