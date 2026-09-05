import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../src/server";
import { buildDid } from "../src/services/did.service";
import { readField } from "../src/services/vault.service";
import { victim, attacker, loginAs } from "./setup";

/// P0.2 — PII vault poisoning via unvalidated identifiers.
/// Attack scenario being closed: a logged-in attacker POSTs a VICTIM's
/// didHash to /identity/digilocker-import, attempting to write
/// attacker-controlled document fields into the victim's PII vault record.
describe("P0.2 identity digilocker-import PII poisoning", () => {
  const { didHash: victimDidHash } = buildDid(victim.address);
  const { didHash: attackerDidHash } = buildDid(attacker.address);

  beforeAll(async () => {
    // Off-chain user rows must exist for the pii_vault FK.
    const victimAgent = await loginAs(app, victim);
    await victimAgent.post("/identity/did");
  }, 60_000);

  it("BLOCKS an attacker from writing PII into a victim's vault record via a body-supplied didHash", async () => {
    const attackerAgent = await loginAs(app, attacker);
    await attackerAgent.post("/identity/did"); // ensure attacker's own users row exists

    const res = await attackerAgent
      .post("/identity/digilocker-import")
      .send({ didHash: victimDidHash, documentType: "10th Marksheet" });

    expect(res.status).toBe(200);

    // The victim's vault must NOT contain the attacker's imported fields —
    // the didHash used for the actual write is derived from the attacker's
    // OWN session, never the body-supplied victim didHash.
    const victimName = await readField(victimDidHash, "student_name");
    expect(victimName).toBeNull();

    // And the data really did land under the attacker's OWN didHash instead
    // (proving the request wasn't silently dropped, just correctly
    // re-targeted).
    const attackerName = await readField(attackerDidHash, "student_name");
    expect(attackerName).toBe("Demo Student");
  });
});
