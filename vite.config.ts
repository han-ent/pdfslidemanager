import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  appType: 'spa',
  build: {
    target: 'es2022',
    sourcemap: true
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts', './tests/setup-locale.ts'],
    globals: true,
    coverage: {
      reporter: ['text', 'lcov']
    }
  }
});
