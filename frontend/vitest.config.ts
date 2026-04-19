import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig uses `jsx: preserve` for Next.js; vitest transforms TSX via esbuild,
  // so we opt into the automatic JSX runtime here to avoid `React is not defined`.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
