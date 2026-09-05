import { describe, it, expect, beforeAll } from "vitest";
import { ethers } from "ethers";
import { app } from "../src/server";
import { buildDid } from "../src/services/did.service";
import { storeField, readField } from "../src/services/vault.service";
import { query } from "../src/db/client";
import { provider, adminA, adminB, grantAdminRole, loginAs } from "./setup";

/// P0.3 — Ungoverned, unaudited DPDP erasure.
/// Attack/failure scenario being closed: a single Admin session used to be
/// able to call POST /vault/erase and immediately, unilaterally destroy a
/// citizen's PII with no second approval and no audit record. This test
/// proves a lone Admin session cannot push an erasure through alone, and
/// that it only executes once a SECOND, DISTINCT Admin approves — with an
/// audit trail written before the key material is destroyed.
describe("P0.3 governed vault erasure", () => {
  beforeAll(async () => {
    await grantAdminRole(adminA.address);
    await grantAdminRole(adminB.address);
  }, 120_000);

  async function freshVictimWithPii() {
    const victim = ethers.Wallet.createRandom().connect(provider);
    const agent = await loginAs(app, victim as unknown as ethers.Wallet);
    await agent.post("/identity/did");
    const { didHash } = buildDid(victim.address);
    await storeField(didHash, "aadhaar_number", "1234-5678-9999");
    return { victim, didHash };
  }

  it("does NOT erase on a single Admin session — request stays pending", async () => {
    const { didHash } = await freshVictimWithPii();
    const adminAgentA = await loginAs(app, adminA);

    const res1 = await adminAgentA.post("/vault/erase").send({ didHash, reason: "test request" });
    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe("pending");
    expect(res1.body.approvals).toBe(1);
    expect(res1.body.erased).toBe(false);

    // The SAME admin calling again must not push it through alone either.
    const res2 = await adminAgentA.post("/vault/erase").send({ didHash });
    expect(res2.body.status).toBe("pending");
    expect(res2.body.approvals).toBe(1);

    // PII must still be readable — nothing was destroyed.
    const stillThere = await readField(didHash, "aadhaar_number");
    expect(stillThere).toBe("1234-5678-9999");
  });

  it("executes only once a SECOND, DISTINCT Admin approves, with an audit trail", async () => {
    const { didHash } = await freshVictimWithPii();
    const adminAgentA = await loginAs(app, adminA);
    const adminAgentB = await loginAs(app, adminB);

    const res1 = await adminAgentA.post("/vault/erase").send({ didHash, reason: "citizen requested erasure" });
    expect(res1.body.status).toBe("pending");

    const res2 = await adminAgentB.post("/vault/erase").send({ didHash });
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe("executed");
    expect(res2.body.approvals).toBe(2);
    expect(res2.body.erased).toBe(true);
    expect(res2.body.erasedRows).toBeGreaterThanOrEqual(1);

    const erased = await readField(didHash, "aadhaar_number");
    expect(erased).toBeNull();

    // Audit trail exists and was written for requested/approved/executed,
    // in order, before the erasure completed.
    const audit = await query<{ actor: string; action: string }>(
      `SELECT actor, action FROM erasure_audit_log WHERE erasure_request_id = $1 ORDER BY created_at ASC`,
      [res1.body.id]
    );
    expect(audit.map((a) => a.action)).toEqual(["requested", "approved", "executed"]);
    expect(audit[0].actor.toLowerCase()).toBe(adminA.address.toLowerCase());
    expect(audit[2].actor.toLowerCase()).toBe(adminB.address.toLowerCase());
  });

  it("rejects a non-Admin session outright", async () => {
    const { didHash } = await freshVictimWithPii();
    const nonAdmin = ethers.Wallet.createRandom().connect(provider);
    const agent = await loginAs(app, nonAdmin as unknown as ethers.Wallet);
    const res = await agent.post("/vault/erase").send({ didHash });
    expect(res.status).toBe(403);
  });
});
