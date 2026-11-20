import { defineConfig } from 'vitest/config'

// Pruebas automáticas (RNF10): unitarias en src/data, integración con PostgreSQL en server y db
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'db/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
})
