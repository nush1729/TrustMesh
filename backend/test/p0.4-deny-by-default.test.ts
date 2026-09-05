import { describe, it, expect } from "vitest";
import request from "supertest";
import { ethers } from "ethers";
import { app } from "../src/server";

/// P0.4 — Deny-by-default authentication gate.
/// Failure mode being closed: previously, a new route was silently PUBLIC
/// unless its author remembered to attach requireSession individually. This
/// test adds a brand-new route with NO auth code of its own — exactly the
/// "a developer forgot" scenario — and confirms the app-level gate in
/// server.ts still rejects it by default.
describe("P0.4 deny-by-default auth gate", () => {
  it("rejects a newly-added route that attaches no auth middleware of its own", async () => {
    app.get("/__test_only_forgotten_route", (_req, res) => res.json({ leaked: "this should never be reachable" }));

    const res = await request(app).get("/__test_only_forgotten_route");
    expect(res.status).toBe(401);
    expect(res.body.leaked).toBeUndefined();
  });

  it("keeps the 3-entry citizen allowlist public", async () => {
    const health = await request(app).get("/health");
    expect(health.status).toBe(200);

    const challenge = await request(app).post("/auth/challenge").send({ address: ethers.Wallet.createRandom().address });
    expect(challenge.status).toBe(200);
  });

  it("still requires a session on an existing, previously-per-route-guarded route", async () => {
    const res = await request(app).get("/audit/feed");
    expect(res.status).toBe(401);
  });

  it("still allows /verify/:did through as a deliberate, separate public path (not the citizen allowlist)", async () => {
    const res = await request(app).get(`/verify/did:ethr:31337:${ethers.Wallet.createRandom().address}`);
    expect(res.status).toBe(200);
  });
});
