import { describe, it, expect } from "vitest";
import { uploadJsonToIpfs, uploadFileToIpfs } from "../src/services/ipfs.service";

/// P3.1: ipfs.service.ts was rewritten against a private, self-hosted Kubo
/// node instead of the public Pinata SaaS. These tests require a local
/// Kubo daemon running (`ipfs daemon`, default API at http://127.0.0.1:5001)
/// — they are real integration tests against real Kubo, not mocks, since the
/// whole point of this migration is that the content actually lands on
/// institution-controlled infrastructure.
describe("P3.1 — Kubo IPFS integration", () => {
  it("uploads JSON and returns a real CID plus a matching content hash", async () => {
    const data = { assetType: "equipment-spec", label: `test-${Date.now()}` };
    const { cid, contentHash } = await uploadJsonToIpfs(data);

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
    const { cid, contentHash } = await uploadFileToIpfs(fileContent, "spec.txt");

    expect(cid).toMatch(/^Qm|^bafy/);
    expect(contentHash).toMatch(/^0x[0-9a-f]{64}$/);

    const res = await fetch(`http://127.0.0.1:5001/api/v0/cat?arg=${cid}`, { method: "POST" });
    expect(res.ok).toBe(true);
    const fetched = Buffer.from(await res.arrayBuffer());
    expect(fetched.equals(fileContent)).toBe(true);
  });

  it("two different files produce two different CIDs and content hashes", async () => {
    const a = await uploadJsonToIpfs({ x: 1 });
    const b = await uploadJsonToIpfs({ x: 2 });
    expect(a.cid).not.toBe(b.cid);
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});
