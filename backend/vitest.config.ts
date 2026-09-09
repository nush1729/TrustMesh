import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Shared with vitest.fabric.config.ts: supplies dev defaults for the vault
    // key, VC issuer key and DATABASE_URL so a bare `npm test` works without a
    // .env, while never overriding a value CI or a developer already set.
    setupFiles: ["test/env.setup.ts"],
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false, // tests share one Postgres DB
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    // test/fabric/** has its own config (vitest.fabric.config.ts, run via
    // `npm run test:fabric`) with Fabric-scale timeouts and a dependency on a
    // live 3-org network. This config covers everything that does NOT need
    // that network, so `npm run test` stays runnable with only Postgres and
    // Kubo up. Without the exclude, vitest's default glob would pull the
    // Fabric suite in here and it would fail for want of a network rather
    // than for want of correctness.
    exclude: ["**/node_modules/**", "**/dist/**", "test/fabric/**"],
  },
});
