/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: 'tsconfig.spec.json',
    }],
  },
  testMatch: ['**/src/**/*.spec.ts'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/services/**/*.ts', 'src/utils/**/*.ts'],
};
