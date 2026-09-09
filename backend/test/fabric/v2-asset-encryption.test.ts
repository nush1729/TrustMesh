import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/server.fabric';
import { config } from '../../src/config';
import { closeGateways, pingChaincode } from '../../src/fabric/gateway';
import { startIndexer, stopIndexer } from '../../src/fabric/indexer.service';
import { assetsByOwner } from '../../src/fabric/registry.service';
import { bootstrapRole, loginAs, newCitizen, registerCitizen, TestCitizen } from './helpers';

/**
 * V2 REGRESSION SUITE — asset documents uploaded unencrypted to IPFS
 * (security audit §9/§V2).
 *
 * Root cause: POST /assets/mint carried only a comment saying a document
 * should be encrypted before uploadFileToIpfs — no encryption ever actually
 * happened. Live exploit: a file containing a PII marker string, minted
 * through the real, authenticated endpoint, was retrieved in PLAINTEXT
 * directly from Kubo (`/api/v0/cat`) — bypassing the backend and its
 * authentication/authorization entirely.
 *
 * This suite reproduces that exact exploit attempt against the FIXED code
 * and proves it now fails (no plaintext at the storage layer), then proves
 * the new GET /assets/:assetId/document endpoint is the only way back to the
 * plaintext, and only for the owner/Admin/Auditor.
 */

const PII_MARKER = 'TRUSTMESH-V2-AUDIT-PII-MARKER-do-not-leak-this-ssn-123-45-6789';

let admin: TestCitizen;
let admin2: TestCitizen;
let adminAgent: request.SuperAgentTest;
let admin2Agent: request.SuperAgentTest;

async function kuboCat(cid: string): Promise<Buffer> {
  const res = await fetch(`${config.ipfsApiUrl}/api/v0/cat?arg=${encodeURIComponent(cid)}`, { method: 'POST' });
  if (!res.ok) throw new Error(`Kubo cat failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

beforeAll(async () => {
  await pingChaincode();
  startIndexer();

  admin = newCitizen();
  admin2 = newCitizen();
  await registerCitizen(app, admin);
  await registerCitizen(app, admin2);
  await bootstrapRole('Admin', admin.didHash, undefined, 'org1');
  await bootstrapRole('Admin', admin2.didHash, undefined, 'org2');
  adminAgent = await loginAs(app, admin);
  admin2Agent = await loginAs(app, admin2);
}, 180_000);

afterAll(async () => {
  stopIndexer();
  await closeGateways();
});

describe('V2: asset documents are encrypted before they ever reach IPFS', () => {
  it('(a) a PII-marked file minted through the real endpoint is NOT retrievable in plaintext directly from Kubo', async () => {
    const owner = newCitizen();
    await registerCitizen(app, owner);

    // A minimal, real, well-formed PDF (passes V3's magic-byte check) whose
    // body embeds the PII marker string, mirroring the audit's exact setup.
    const plaintext = Buffer.from(
      `%PDF-1.4\n% ${PII_MARKER}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF`,
      'utf8'
    );
    expect(plaintext.toString('utf8')).toContain(PII_MARKER);

    const mint = await adminAgent
      .post('/assets/mint')
      .field('to', owner.didHash)
      .field('encrypted', 'false') // caller honestly says "not pre-encrypted" — server must still encrypt it
      .attach('file', plaintext, 'pii-document.pdf');
    expect(mint.status).toBe(200);
    const { ipfsCID, proposalId } = mint.body as { ipfsCID: string; proposalId: string };
    expect(ipfsCID).toBeTruthy();

    // THE LIVE EXPLOIT, REPRODUCED: fetch the raw CID directly from Kubo,
    // exactly as the audit did, completely bypassing the backend.
    const rawFromKubo = await kuboCat(ipfsCID);
    expect(rawFromKubo.toString('utf8')).not.toContain(PII_MARKER);
    expect(rawFromKubo.equals(plaintext)).toBe(false);

    // Sanity: it's genuinely different, non-empty ciphertext, not e.g. an
    // empty upload or a silently-unmodified copy under a different guise.
    expect(rawFromKubo.length).toBeGreaterThan(0);

    await admin2Agent.post('/governance/approve').send({ proposalId });
    await adminAgent.post('/governance/execute').send({ proposalId });
  });

  it('(b) GET /assets/:assetId/document returns the correct original plaintext to the owner', async () => {
    const owner = newCitizen();
    await registerCitizen(app, owner);
    const ownerAgent = await loginAs(app, owner);

    const plaintext = Buffer.from(`%PDF-1.4\n% ${PII_MARKER}-b\n%%EOF`, 'utf8');
    const mint = await adminAgent
      .post('/assets/mint')
      .field('to', owner.didHash)
      .field('encrypted', 'false')
      .attach('file', plaintext, 'doc-b.pdf');
    expect(mint.status).toBe(200);
    const { proposalId } = mint.body as { proposalId: string };
    await admin2Agent.post('/governance/approve').send({ proposalId });
    await adminAgent.post('/governance/execute').send({ proposalId });

    const assetId = (await assetsByOwner(owner.didHash)).find((a) => true)!.assetId;

    const doc = await ownerAgent.get(`/assets/${assetId}/document`);
    expect(doc.status).toBe(200);
    expect(Buffer.from(doc.body as Buffer).equals(plaintext)).toBe(true);
  });

  it('(c) a non-owner, non-Admin, non-Auditor caller gets 403', async () => {
    const owner = newCitizen();
    const stranger = newCitizen();
    await registerCitizen(app, owner);
    await registerCitizen(app, stranger);
    const strangerAgent = await loginAs(app, stranger);

    const plaintext = Buffer.from(`%PDF-1.4\n% ${PII_MARKER}-c\n%%EOF`, 'utf8');
    const mint = await adminAgent
      .post('/assets/mint')
      .field('to', owner.didHash)
      .field('encrypted', 'false')
      .attach('file', plaintext, 'doc-c.pdf');
    const { proposalId } = mint.body as { proposalId: string };
    await admin2Agent.post('/governance/approve').send({ proposalId });
    await adminAgent.post('/governance/execute').send({ proposalId });

    const assetId = (await assetsByOwner(owner.didHash)).find((a) => true)!.assetId;

    const res = await strangerAgent.get(`/assets/${assetId}/document`);
    expect(res.status).toBe(403);

    // An Admin or Auditor, meanwhile, CAN retrieve it — this is a real
    // ownership/role check, not a route that simply always fails.
    const asAdmin = await adminAgent.get(`/assets/${assetId}/document`);
    expect(asAdmin.status).toBe(200);

    const auditor = newCitizen();
    await registerCitizen(app, auditor);
    await bootstrapRole('Auditor', auditor.didHash);
    const auditorAgent = await loginAs(app, auditor);
    const asAuditor = await auditorAgent.get(`/assets/${assetId}/document`);
    expect(asAuditor.status).toBe(200);
  });
});
