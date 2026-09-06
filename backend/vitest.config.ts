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
    // test/fabric/** has its own config (vitest.fabric.config.ts, run via
    // `npm run test:fabric`) with Fabric-scale timeouts and a live network
    // dependency. Without this exclude, vitest's default glob picks up those
    // files here too, and the two suites collide — the Fabric tests' rapid
    // DID registrations trip this run's rate limiter, and EVM-only `npm run
    // test` stops being a reliable signal for the fallback stack.
    exclude: ["**/node_modules/**", "**/dist/**", "test/fabric/**"],
  },
});
