import { describe, it, expect, beforeAll } from "vitest";
import { ethers } from "ethers";
import { app } from "../src/server";
import { listGuardians } from "../src/services/recovery.service";
import { buildDid } from "../src/services/did.service";
import { victim, attacker, registerDidOnChain, loginAs } from "./setup";

/// P0.1 — Identity hijack via the guardian-recovery endpoint.
/// Attack scenario being closed: a logged-in attacker POSTs a VICTIM's
/// didHash (taken from public on-chain data) to /recovery/guardians along
/// with an address they control, attempting to register themselves as that
/// victim's "guardian" so they can later vote a fraudulent recovery through.
describe("P0.1 recovery guardian-add hijack", () => {
  const { didHash: victimDidHash } = buildDid(victim.address);

  beforeAll(async () => {
    await registerDidOnChain(victim);
    await registerDidOnChain(attacker);
  }, 60_000);

  // A fresh, random address each run, so this test is idempotent across
  // repeated test-suite runs against the same persistent local chain/DB.
  const legitimateGuardian = ethers.Wallet.createRandom().address;

  it("lets a user add a guardian for their OWN did", async () => {
    const victimAgent = await loginAs(app, victim);
    const res = await victimAgent.post("/recovery/guardians").send({ guardianAddress: legitimateGuardian });
    expect(res.status).toBe(200);
    expect(res.body.didHash).toBe(victimDidHash);

    const guardians = await listGuardians(victimDidHash);
    expect(guardians).toContain(legitimateGuardian);
  });

  it("BLOCKS an attacker from adding themselves as a guardian for someone else's didHash", async () => {
    const attackerAgent = await loginAs(app, attacker);
    const guardiansBefore = await listGuardians(victimDidHash);

    // The attacker tries the exact P0.1 exploit: supply the VICTIM's
    // didHash in the body, hoping the server trusts it.
    const res = await attackerAgent
      .post("/recovery/guardians")
      .send({ didHash: victimDidHash, guardianAddress: attacker.address });

    // The fix derives didHash from the attacker's OWN session, ignoring the
    // body entirely, so this call can only ever affect the ATTACKER's own
    // DID — never the victim's. Assert the victim's guardian list is
    // completely unaffected by the attacker's call, regardless of what
    // status code came back.
    const victimGuardiansAfter = await listGuardians(victimDidHash);
    expect(victimGuardiansAfter).not.toContain(attacker.address);
    expect(victimGuardiansAfter).toEqual(guardiansBefore);

    // And prove it structurally, not just "it happened not to work": if the
    // call succeeded at all, it must have added the guardian to the
    // ATTACKER's own did, not the victim's.
    if (res.status === 200) {
      const { didHash: attackerDidHash } = buildDid(attacker.address);
      expect(res.body.didHash).toBe(attackerDidHash);
      expect(res.body.didHash).not.toBe(victimDidHash);
    }
  });
});
