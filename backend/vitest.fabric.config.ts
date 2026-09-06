import { defineConfig } from 'vitest/config';

/**
 * Separate vitest config for the Fabric stack, so the EVM regression tests
 * (which guard the live Stage 1 P0 security fixes) keep their own config and
 * keep running untouched throughout the migration.
 *
 *   npm run test          -> EVM tests   (vitest.config.ts)
 *   npm run test:fabric   -> Fabric tests (this file)
 *
 * Timeouts are generous because these tests submit REAL transactions to a real
 * Fabric network: each governed action is a propose + approve + execute, and
 * every one of those must be endorsed by two organizations, ordered, and
 * committed before the next step.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/fabric/**/*.test.ts'],
    setupFiles: ['test/fabric/env.setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
