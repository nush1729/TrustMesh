import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { ethers } from "ethers";
import { app, errorHandler, assertSafeLocalModeGuard } from "../src/server";
import { assertChainConfigured, config } from "../src/config";
import { query } from "../src/db/client";
import { provider } from "./setup";

describe("P1 thin slice — helmet", () => {
  it("sets helmet security headers and removes x-powered-by", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    // helmet sets this by default
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("P1 thin slice — session tokens hashed, nonce expiry", () => {
  it("never stores the raw session token server-side", async () => {
    const wallet = ethers.Wallet.createRandom().connect(provider);
    const challengeRes = await request(app).post("/auth/challenge").send({ address: wallet.address });
    const { nonce } = challengeRes.body as { nonce: string };
    const signature = await wallet.signMessage(`TrustMesh DID challenge: ${nonce}`);
    const verifyRes = await request(app).post("/auth/verify").send({ address: wallet.address, signature, nonce });

    const rawToken: string = verifyRes.body.sessionToken;
    expect(rawToken).toBeTruthy();

    const rows = await query<{ token: string }>(`SELECT token FROM sessions WHERE wallet_address = $1`, [wallet.address]);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.token).not.toBe(rawToken); // stored value must not equal the raw cookie token
    }
  });

  it("rejects an expired nonce even with a correct signature", async () => {
    const wallet = ethers.Wallet.createRandom().connect(provider);
    const challengeRes = await request(app).post("/auth/challenge").send({ address: wallet.address });
    const { nonce } = challengeRes.body as { nonce: string };

    // Simulate the nonce having been issued 10 minutes ago (TTL is 5 min).
    await query(`UPDATE auth_nonces SET created_at = now() - interval '10 minutes' WHERE nonce = $1`, [nonce]);

    const signature = await wallet.signMessage(`TrustMesh DID challenge: ${nonce}`);
    const verifyRes = await request(app).post("/auth/verify").send({ address: wallet.address, signature, nonce });
    expect(verifyRes.status).toBe(401);
    expect(verifyRes.body.error).toMatch(/expired/i);
  });
});

describe("P1 thin slice — sanitized error handler", () => {
  it("never leaks err.message to the client", () => {
    const req = {} as any;
    const jsonMock = vi.fn();
    const statusMock = vi.fn(() => ({ json: jsonMock }));
    const res = { status: statusMock } as any;
    const secretErr = new Error("password=hunter2 at /etc/secret/config.js constraint violated");

    errorHandler(secretErr, req, res, (() => {}) as any);

    expect(statusMock).toHaveBeenCalledWith(500);
    const body = jsonMock.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(body)).not.toContain("/etc/secret");
    expect(body.correlationId).toBeTruthy();
  });
});

describe("P1 thin slice — boot guards", () => {
  it("assertChainConfigured throws when a contract address is unset", () => {
    // assertChainConfigured() re-reads process.env directly (see config.ts's
    // `required()`), so the env var — not the already-resolved config object
    // — must be unset to exercise the fail-fast check.
    const original = process.env.DID_REGISTRY_ADDRESS;
    delete process.env.DID_REGISTRY_ADDRESS;
    try {
      expect(() => assertChainConfigured()).toThrow(/DID_REGISTRY_ADDRESS/);
    } finally {
      process.env.DID_REGISTRY_ADDRESS = original;
    }
  });

  it("refuses to start with SAFE_LOCAL_MODE=true on a non-local chain id", () => {
    const originalMode = config.safeLocalMode;
    const originalChainId = config.chainId;
    config.safeLocalMode = true;
    config.chainId = 80002; // Amoy, not local Hardhat
    try {
      expect(() => assertSafeLocalModeGuard()).toThrow(/SAFE_LOCAL_MODE/);
    } finally {
      config.safeLocalMode = originalMode;
      config.chainId = originalChainId;
    }
  });

  it("allows SAFE_LOCAL_MODE=true on the local Hardhat chain id (31337)", () => {
    expect(config.chainId).toBe(31337);
    expect(() => assertSafeLocalModeGuard()).not.toThrow();
  });
});

// Rate-limiting tests run LAST in this file: they deliberately exhaust the
// /auth/challenge and /verify/:did limiters on this shared `app` instance,
// which would otherwise starve any later test in this file that needs a
// real 200 from those routes.
describe("P1 thin slice — rate limiting", () => {
  it("rate-limits /auth/challenge after repeated requests from the same client", async () => {
    const address = ethers.Wallet.createRandom().address;
    let sawTooManyRequests = false;
    for (let i = 0; i < 25; i++) {
      const res = await request(app).post("/auth/challenge").send({ address });
      if (res.status === 429) {
        sawTooManyRequests = true;
        break;
      }
    }
    expect(sawTooManyRequests).toBe(true);
  });

  it("rate-limits /verify/:did after repeated requests from the same client", async () => {
    const did = `did:ethr:31337:${ethers.Wallet.createRandom().address}`;
    let sawTooManyRequests = false;
    for (let i = 0; i < 35; i++) {
      const res = await request(app).get(`/verify/${did}`);
      if (res.status === 429) {
        sawTooManyRequests = true;
        break;
      }
    }
    expect(sawTooManyRequests).toBe(true);
  });
});
