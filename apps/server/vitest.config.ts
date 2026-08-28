import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Threads, not forks: the socket tests share one HTTP server per file and
    // forked workers are blocked in some sandboxed environments.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 45_000,
    hookTimeout: 20_000,
    include: ['tests/**/*.test.ts']
  }
});
