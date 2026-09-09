import * as crypto from "crypto";
import { describe, it, expect } from "vitest";
import {
  forgetContentCommitment,
  uploadFileToIpfs,
  uploadJsonToIpfs,
  verifyContentCommitment,
} from "../src/services/ipfs.service";

/// P3.1: ipfs.service.ts was rewritten against a private, self-hosted Kubo
/// node instead of the public Pinata SaaS. These tests require a local
/// Kubo daemon running (`ipfs daemon`, default API at http://127.0.0.1:5001)
/// — they are real integration tests against real Kubo, not mocks, since the
/// whole point of this migration is that the content actually lands on
/// institution-controlled infrastructure.
describe("P3.1 — Kubo IPFS integration", () => {
  it("uploads JSON and returns a real CID plus a matching content hash", async () => {
    const data = { assetType: "equipment-spec", label: `test-${Date.now()}` };
    // TM-05: encrypted/PII-free is now a required, explicit declaration.
    const { cid, contentHash } = await uploadJsonToIpfs(data, false);

    expect(cid).toMatch(/^Qm|^bafy/); // CIDv0 or CIDv1
    expect(contentHash).toMatch(/^0x[0-9a-f]{64}$/);

    // Fetch it back from Kubo's gateway to prove it actually landed there,
    // not just that the API call returned 200.
    const res = await fetch(`http://127.0.0.1:5001/api/v0/cat?arg=${cid}`, { method: "POST" });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual(data);
  });

  it("uploads a raw file buffer and returns a CID whose content round-trips", async () => {
    const fileContent = Buffer.from(`sample asset document ${Date.now()}`);
    const { cid, contentHash } = await uploadFileToIpfs(fileContent, "spec.txt", false);

    expect(cid).toMatch(/^Qm|^bafy/);
    expect(contentHash).toMatch(/^0x[0-9a-f]{64}$/);

    const res = await fetch(`http://127.0.0.1:5001/api/v0/cat?arg=${cid}`, { method: "POST" });
    expect(res.ok).toBe(true);
    const fetched = Buffer.from(await res.arrayBuffer());
    expect(fetched.equals(fileContent)).toBe(true);
  });

  it("two different files produce two different CIDs and content hashes", async () => {
    const a = await uploadJsonToIpfs({ x: 1 }, false);
    const b = await uploadJsonToIpfs({ x: 2 }, false);
    expect(a.cid).not.toBe(b.cid);
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});

describe("CRY-3 — the anchored commitment is salted, not a bare content hash", () => {
  /**
   * The property under test is not "the hash is correct" — it is that a bare
   * hash of the content does NOT reproduce what gets anchored. That is what
   * stops the ledger from being a permanent confirmation oracle: someone
   * holding a candidate document must also hold the salt, which only Postgres
   * has, to check it against the anchor.
   */
  it("cannot be reproduced by hashing the content alone", async () => {
    const body = Buffer.from(`asset document ${Date.now()}`);
    const { contentHash } = await uploadFileToIpfs(body, "doc.txt", false);

    const bare = "0x" + crypto.createHash("sha256").update(body).digest("hex");
    expect(contentHash).not.toBe(bare);
    expect(contentHash).toMatch(/^0x[0-9a-f]{64}$/); // same shape, different value
  });

  it("verifies against the original bytes and rejects anything else", async () => {
    const body = Buffer.from(`asset document ${Date.now()}`);
    const { cid, contentHash } = await uploadFileToIpfs(body, "doc.txt", false);

    expect(await verifyContentCommitment(cid, body, contentHash)).toEqual({ result: "match" });
    expect(await verifyContentCommitment(cid, Buffer.from("a different document"), contentHash)).toEqual({
      result: "mismatch",
    });
  });

  it("becomes permanently unverifiable once the salt is destroyed", async () => {
    const body = Buffer.from(`asset document ${Date.now()}`);
    const { cid, contentHash } = await uploadFileToIpfs(body, "doc.txt", false);

    // Precondition: it verifies while the salt still exists.
    expect(await verifyContentCommitment(cid, body, contentHash)).toEqual({ result: "match" });

    expect(await forgetContentCommitment(cid)).toEqual({ forgotten: true });

    // THE DPDP PROPERTY. Even holding the exact original bytes and the exact
    // commitment still on the ledger, the anchor can no longer be tied to the
    // document. Before CRY-3 this assertion was impossible to make: a bare
    // keccak256 anchor stayed checkable by anyone, forever, no matter what was
    // deleted off-chain.
    expect(await verifyContentCommitment(cid, body, contentHash)).toEqual({ result: "unverifiable" });
  });
});
