import type { Config } from 'jest';

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            tsconfig: {
                target: 'ES2022',
                module: 'commonjs',
                esModuleInterop: true,
                allowSyntheticDefaultImports: true,
                strict: true,
                moduleResolution: 'node',
                resolveJsonModule: true,
            },
        }],
    },
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    testMatch: [
        '**/tests/**/*.test.ts',
        '**/tests/**/*.spec.ts',
    ],
    collectCoverageFrom: [
        'src/services/**/*.ts',
        'src/rtb/**/*.ts',
        'src/routes/**/*.ts',
        '!src/**/*.d.ts',
    ],
    coverageThreshold: {
        global: {
            branches: 60,
            functions: 70,
            lines: 70,
            statements: 70,
        },
    },
    coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],
    coverageDirectory: 'coverage',
    verbose: true,
    testTimeout: 30000,
    forceExit: true,
    detectOpenHandles: true,
};

export default config;
