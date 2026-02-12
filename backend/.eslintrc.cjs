module.exports = {
    env: { node: true, es2022: true, jest: true },
    parser: '@typescript-eslint/parser',
    parserOptions: { sourceType: 'module' },
    plugins: ['@typescript-eslint'],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
    ],
    rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        '@typescript-eslint/no-require-imports': 'off',
        'no-console': 'off',
    },
    ignorePatterns: ['dist/', 'node_modules/', 'coverage/', '*.js'],
};
