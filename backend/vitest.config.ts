import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false, // tests share one Postgres DB + one local chain
    pool: "forks",
    poolOptions: { forks: { singleFork: true } }, // avoid concurrent on-chain nonce races across test files
  },
});
