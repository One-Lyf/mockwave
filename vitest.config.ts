import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts, whose root is the app.
export default defineConfig({
  test: { include: ['engine/src/**/*.test.ts'] },
});
