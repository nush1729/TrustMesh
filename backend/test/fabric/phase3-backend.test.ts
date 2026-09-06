import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/server.fabric';
import { closeGateways, pingChaincode } from '../../src/fabric/gateway';
import { getController, registerUser } from '../../src/fabric/did.service';
import { issueCredential, issuerDidFromPrivateKey, verifyCredentialJwt } from '../../src/fabric/vc.service';
import {
  getProposal,
  proposeAction,
  approveProposal,
  executeProposal,
  proposeApproveExecute,
} from '../../src/fabric/governance.service';
import { activeRolesFor, assetsByOwner, hasActiveRole } from '../../src/fabric/registry.service';
import { getCachedAuditFeed, startIndexer, stopIndexer, waitForEvent } from '../../src/fabric/indexer.service';
import { bootstrapRole, loginAs, newCitizen, registerCitizen, TestCitizen } from './helpers';

/**
 * PHASE 3 VERIFICATION — every rewritten backend service exercised against the
 * REAL running Fabric network, per the completion criteria in
 * docs/IMPLEMENTATION_PROMPT.md ("tested against the real Fabric network, not
 * mocks").
 *
 * There are no mocks, stubs or fakes anywhere in this file. Every assertion
 * below is the result of a real gRPC call to a real peer, a real endorsement
 * from two organizations, and a real committed block.
 *
 * Service coverage, mapped to the migration proposal's §6 Phase 3 list:
 *   chain.service.ts   -> fabric/gateway.ts          (§1)
 *   did.service.ts     -> fabric/did.service.ts      (§2)
 *   vc.service.ts      -> fabric/vc.service.ts       (§3)
 *   safe.service.ts    -> fabric/governance.service.ts (§4)
 *   recovery.service.ts-> fabric/recovery.service.ts (§5)
 *   indexer.service.ts -> fabric/indexer.service.ts  (§6)
 *   route handlers     -> routes/fabric/*            (§7)
 */

let admin: TestCitizen;
let citizen: TestCitizen;
let adminAgent: request.SuperAgentTest;

beforeAll(async () => {
  await pingChaincode();
  startIndexer();

  admin = newCitizen();
  citizen = newCitizen();

  await registerCitizen(app, admin);
  await registerCitizen(app, citizen);

  // Genesis governance action — see helpers.bootstrapRole.
  await bootstrapRole('Admin', admin.didHash);
  adminAgent = await loginAs(app, admin);
}, 180_000);

afterAll(async () => {
  stopIndexer();
  await closeGateways();
});

describe('gateway (replaces chain.service.ts)', () => {
  it('reaches the peer, channel and chaincode over real gRPC/TLS/MSP', async () => {
    const health = await pingChaincode();
    expect(health).toMatchObject({ ok: true, channel: 'trustmesh', chaincode: 'trustmesh' });
  });

  it('exposes chain health over HTTP', async () => {
    const res = await request(app).get('/health/chain');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('did.service (replaces did.service.ts)', () => {
  it('registers a did:key on the ledger and records the off-chain row', async () => {
    const c = newCitizen();
    const result = await registerCitizen(app, c);
    expect(result.did).toBe(c.did);
    expect(result.didHash).toBe(c.didHash);
    // Read back from the ledger, not from the response we just got.
    expect(await getController(c.didHash)).toBe(c.publicKeyB64);
  });

  it('rejects a registration whose signature does not match the public key', async () => {
    const a = newCitizen();
    const b = newCitizen();
    const res = await request(app)
      .post('/identity/did')
      .send({ publicKey: a.publicKeyB64, signature: b.sign(a.did) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/possession/i);
  });

  it('rejects a malformed public key', async () => {
    const res = await request(app).post('/identity/did').send({ publicKey: 'bm90LWEta2V5', signature: 'AAAA' });
    expect(res.status).toBe(400);
  });
});

describe('auth (signed challenge against the ledger-held key)', () => {
  it('issues a session for a correctly signed challenge', async () => {
    const c = newCitizen();
    await registerCitizen(app, c);
    const agent = await loginAs(app, c);
    const me = await agent.get('/identity/me');
    expect(me.status).toBe(200);
    expect(me.body.didHash).toBe(c.didHash);
  });

  it('rejects a challenge signed by the wrong key', async () => {
    const c = newCitizen();
    const impostor = newCitizen();
    await registerCitizen(app, c);

    const agent = request.agent(app);
    const { body } = await agent.post('/auth/challenge').send({ did: c.did });
    const signature = impostor.sign(`TrustMesh DID challenge: ${body.nonce}`);

    const res = await agent.post('/auth/verify').send({ did: c.did, signature, nonce: body.nonce });
    expect(res.status).toBe(401);
  });

  it('refuses to reuse a nonce', async () => {
    const c = newCitizen();
    await registerCitizen(app, c);
    const agent = request.agent(app);
    const { body } = await agent.post('/auth/challenge').send({ did: c.did });
    const signature = c.sign(`TrustMesh DID challenge: ${body.nonce}`);

    expect((await agent.post('/auth/verify').send({ did: c.did, signature, nonce: body.nonce })).status).toBe(200);
    const replay = await agent.post('/auth/verify').send({ did: c.did, signature, nonce: body.nonce });
    expect(replay.status).toBe(401);
  });

  // Stage 1 P0.4 must survive the migration, not be quietly dropped.
  it('denies unauthenticated access by default to a non-allowlisted route', async () => {
    expect((await request(app).get('/audit/feed')).status).toBe(401);
    expect((await request(app).get('/identity/me')).status).toBe(401);
  });
});

describe('governance.service (replaces safe.service.ts)', () => {
  it('proposes without executing — a proposal alone changes nothing', async () => {
    const subject = newCitizen();
    await registerCitizen(app, subject);

    const proposal = await proposeAction('GRANT_ROLE', {
      roleId: (await import('../../src/fabric/identity')).ROLE_NAME_TO_HASH.Auditor,
      subject: subject.didHash,
      expiry: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(proposal.status).toBe('PENDING');
    expect(proposal.approvals).toHaveLength(1);
    expect(await hasActiveRole('Auditor', subject.didHash)).toBe(false);
  });

  it('refuses to execute below the 2-of-3 threshold', async () => {
    const subject = newCitizen();
    await registerCitizen(app, subject);
    const proposal = await proposeAction('GRANT_ROLE', {
      roleId: (await import('../../src/fabric/identity')).ROLE_NAME_TO_HASH.Auditor,
      subject: subject.didHash,
      expiry: Math.floor(Date.now() / 1000) + 3600,
    });
    await expect(executeProposal(proposal.proposalId)).rejects.toThrow();
    expect(await hasActiveRole('Auditor', subject.didHash)).toBe(false);
  });

  it('refuses a second approval from the same organization', async () => {
    const subject = newCitizen();
    await registerCitizen(app, subject);
    const proposal = await proposeAction('GRANT_ROLE', {
      roleId: (await import('../../src/fabric/identity')).ROLE_NAME_TO_HASH.Auditor,
      subject: subject.didHash,
      expiry: Math.floor(Date.now() / 1000) + 3600,
    });
    // org1 proposed, so org1 approving again must not create a quorum.
    await expect(approveProposal(proposal.proposalId, 'org1')).rejects.toThrow();
  });

  it('executes once a second organization approves, and records both approvers', async () => {
    const subject = newCitizen();
    await registerCitizen(app, subject);
    const proposal = await proposeAction('GRANT_ROLE', {
      roleId: (await import('../../src/fabric/identity')).ROLE_NAME_TO_HASH.Auditor,
      subject: subject.didHash,
      expiry: Math.floor(Date.now() / 1000) + 3600,
    });
    await approveProposal(proposal.proposalId, 'org2');
    const executed = await executeProposal(proposal.proposalId);

    expect(executed.status).toBe('EXECUTED');
    const orgs = new Set(executed.approvals.map((a) => a.mspId));
    expect(orgs).toEqual(new Set(['Org1MSP', 'Org2MSP']));
    // Approvals stay individually attributable, not just org-attributable (§3).
    expect(executed.approvals.every((a) => a.signer.length > 0)).toBe(true);
    expect(await hasActiveRole('Auditor', subject.didHash)).toBe(true);
  });
});

describe('roles routes', () => {
  it('gates /roles/grant on a live ledger role check', async () => {
    const nobody = newCitizen();
    await registerCitizen(app, nobody);
    const agent = await loginAs(app, nobody);

    const res = await agent
      .post('/roles/grant')
      .send({ role: 'Manager', subject: nobody.didHash, expiry: Math.floor(Date.now() / 1000) + 3600 });
    expect(res.status).toBe(403);
  });

  it('grants a role end-to-end through the HTTP governance flow', async () => {
    const subject = newCitizen();
    await registerCitizen(app, subject);

    const grant = await adminAgent
      .post('/roles/grant')
      .send({
        role: 'Manager',
        subject: subject.didHash,
        expiry: Math.floor(Date.now() / 1000) + 3600,
        orgLabel: 'Test Department',
      });
    expect(grant.status).toBe(200);
    const { proposalId } = grant.body as { proposalId: string };

    // Not active yet — one organization has approved.
    expect(await hasActiveRole('Manager', subject.didHash)).toBe(false);

    const approve = await adminAgent.post('/governance/approve').send({ proposalId, org: 'org3' });
    expect(approve.status).toBe(200);

    const exec = await adminAgent.post('/governance/execute').send({ proposalId });
    expect(exec.status).toBe(200);

    expect(await hasActiveRole('Manager', subject.didHash)).toBe(true);
    const status = await adminAgent.get(`/roles/status/${proposalId}`);
    expect(status.body).toMatchObject({ isExecuted: true, confirmations: 2, threshold: 2 });
  });

  it('revokes a role end-to-end', async () => {
    const subject = newCitizen();
    await registerCitizen(app, subject);
    await bootstrapRole('Auditor', subject.didHash);
    expect(await hasActiveRole('Auditor', subject.didHash)).toBe(true);

    const revoke = await adminAgent.post('/roles/revoke').send({ role: 'Auditor', subject: subject.didHash });
    expect(revoke.status).toBe(200);
    await adminAgent.post('/governance/approve').send({ proposalId: revoke.body.proposalId, org: 'org2' });
    await adminAgent.post('/governance/execute').send({ proposalId: revoke.body.proposalId });

    expect(await hasActiveRole('Auditor', subject.didHash)).toBe(false);
  });
});

describe('assets routes (governed mint over real IPFS)', () => {
  it('mints an asset to a DID and makes it queryable by owner', async () => {
    const owner = newCitizen();
    await registerCitizen(app, owner);

    const mint = await adminAgent
      .post('/assets/mint')
      .field('to', owner.didHash)
      .attach('file', Buffer.from('trustmesh phase 3 asset payload'), 'asset.txt');
    expect(mint.status).toBe(200);
    expect(mint.body.ipfsCID).toBeTruthy();

    await adminAgent.post('/governance/approve').send({ proposalId: mint.body.proposalId, org: 'org2' });
    await adminAgent.post('/governance/execute').send({ proposalId: mint.body.proposalId });

    // CouchDB rich query — the EVM stack could not answer this authoritatively.
    const assets = await assetsByOwner(owner.didHash);
    expect(assets.length).toBeGreaterThan(0);
    expect(assets[0].ipfsCID).toBe(mint.body.ipfsCID);

    const listed = await adminAgent.get(`/assets/owner/${owner.didHash}`);
    expect(listed.status).toBe(200);
    expect(listed.body.assets.length).toBeGreaterThan(0);
  });

  it('transfers custody only through governance, and records provenance', async () => {
    const from = newCitizen();
    const to = newCitizen();
    await registerCitizen(app, from);
    await registerCitizen(app, to);

    const mint = await adminAgent
      .post('/assets/mint')
      .field('to', from.didHash)
      .attach('file', Buffer.from('transferable asset'), 'asset2.txt');
    await adminAgent.post('/governance/approve').send({ proposalId: mint.body.proposalId, org: 'org2' });
    await adminAgent.post('/governance/execute').send({ proposalId: mint.body.proposalId });

    const assetId = (await assetsByOwner(from.didHash))[0].assetId;

    const transfer = await adminAgent
      .post('/assets/transfer')
      .send({ from: from.didHash, to: to.didHash, assetId });
    expect(transfer.status).toBe(200);
    await adminAgent.post('/governance/approve').send({ proposalId: transfer.body.proposalId, org: 'org3' });
    await adminAgent.post('/governance/execute').send({ proposalId: transfer.body.proposalId });

    expect((await assetsByOwner(to.didHash)).some((a) => a.assetId === assetId)).toBe(true);

    const history = await adminAgent.get(`/assets/${assetId}/history`);
    expect(history.body.history.length).toBeGreaterThanOrEqual(2);
  });
});

describe('vc.service (did:key issuance and verification)', () => {
  it('issues and verifies a credential with no chain involved in verification', async () => {
    const subject = newCitizen();
    const { jwt, issuerDid } = await issueCredential(subject.did, 'TestCredential', { attested: true });
    expect(issuerDid.startsWith('did:key:z')).toBe(true);

    const verified = await verifyCredentialJwt(jwt);
    expect(verified.valid).toBe(true);
    expect((verified.subject as { id: string }).id).toBe(subject.did);
  });

  it('derives a stable issuer did:key from the issuer private key', () => {
    const key = '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d';
    expect(issuerDidFromPrivateKey(key)).toBe(issuerDidFromPrivateKey(key));
    expect(issuerDidFromPrivateKey(key).startsWith('did:key:z')).toBe(true);
  });
});

describe('verify route (public verifier path)', () => {
  it('answers roles and assets for a DID without a session, and returns no PII', async () => {
    const subject = newCitizen();
    await registerCitizen(app, subject);
    await bootstrapRole('Auditor', subject.didHash);

    const res = await request(app).get(`/verify/${encodeURIComponent(subject.did)}`);
    expect(res.status).toBe(200);
    expect(res.body.roles).toContain('Auditor');
    expect(res.body.didHash).toBe(subject.didHash);

    // Nothing resembling personal data may appear in a verifier response.
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/name|address|phone|email|aadhaar/i);
  });

  it('404s an unknown DID', async () => {
    const unknown = newCitizen();
    const res = await request(app).get(`/verify/${encodeURIComponent(unknown.did)}`);
    expect(res.status).toBe(404);
  });
});

describe('recovery.service (governed controller re-binding)', () => {
  it('re-binds a DID to a new key only after the guardian threshold, via governance', async () => {
    const owner = newCitizen();
    await registerCitizen(app, owner);
    const ownerAgent = await loginAs(app, owner);

    const g1 = newCitizen();
    const g2 = newCitizen();
    await registerCitizen(app, g1);
    await registerCitizen(app, g2);
    for (const g of [g1, g2]) {
      const added = await ownerAgent.post('/recovery/guardians').send({ guardianId: g.didHash });
      expect(added.status).toBe(200);
    }

    const rotated = newCitizen();
    const g1Agent = await loginAs(app, g1);
    const proposal = await g1Agent
      .post('/recovery/propose')
      .send({ didHash: owner.didHash, newControllerPublicKey: rotated.publicKeyB64 });
    expect(proposal.status).toBe(200);

    // Threshold for 2 guardians is majority-plus-one = 2, so g2's vote executes it.
    const g2Agent = await loginAs(app, g2);
    const vote = await g2Agent.post('/recovery/vote').send({ requestId: proposal.body.requestId });
    expect(vote.status).toBe(200);
    expect(vote.body.status).toBe('executed');

    // The ledger now recognises the NEW key as controller.
    expect(await getController(owner.didHash)).toBe(rotated.publicKeyB64);

    // And the old key can no longer log in — the rotation is real, not cosmetic.
    const agent = request.agent(app);
    const { body } = await agent.post('/auth/challenge').send({ did: owner.did });
    const oldSig = owner.sign(`TrustMesh DID challenge: ${body.nonce}`);
    expect((await agent.post('/auth/verify').send({ did: owner.did, signature: oldSig, nonce: body.nonce })).status).toBe(401);
  });

  // Stage 1 P0.1 must survive the migration.
  it('does not let a caller add a guardian to someone else’s DID', async () => {
    const victim = newCitizen();
    const attacker = newCitizen();
    await registerCitizen(app, victim);
    await registerCitizen(app, attacker);

    const attackerAgent = await loginAs(app, attacker);
    // The route derives didHash from the session, so the attacker can only ever
    // add a guardian to their OWN DID — there is no body field to point elsewhere.
    const res = await attackerAgent.post('/recovery/guardians').send({
      guardianId: attacker.didHash,
      didHash: victim.didHash, // ignored, not merged
    });
    expect(res.status).toBe(200);
    expect(res.body.didHash).toBe(attacker.didHash);
    expect(res.body.didHash).not.toBe(victim.didHash);
  });
});

describe('indexer.service (durable, checkpointed event stream)', () => {
  it('projects ledger events into a PII-free audit feed', async () => {
    const subject = newCitizen();
    await registerCitizen(app, subject);

    const found = await waitForEvent((e) => e.type === 'DID_REGISTERED' && e.actor === subject.didHash);
    expect(found).toBeDefined();
    expect(found!.txHash).toBeTruthy();
    expect(found!.blockNumber).toBeTruthy();
  });

  it('records who proposed and who approved a governed action', async () => {
    const subject = newCitizen();
    await registerCitizen(app, subject);
    await proposeApproveExecute('GRANT_ROLE', {
      roleId: (await import('../../src/fabric/identity')).ROLE_NAME_TO_HASH.User,
      subject: subject.didHash,
      expiry: Math.floor(Date.now() / 1000) + 3600,
    });

    const event = await waitForEvent((e) => e.type === 'ROLE_GRANTED' && e.actor === subject.didHash);
    expect(event).toBeDefined();
    expect(event!.governance?.approvals?.length).toBeGreaterThanOrEqual(2);
    // The audit trail names the organizations, satisfying §3's attributability claim.
    expect(new Set(event!.governance!.approvals!.map((a) => a.mspId)).size).toBeGreaterThanOrEqual(2);
  });

  it('serves the feed over HTTP without leaking PII', async () => {
    const res = await adminAgent.get('/audit/feed');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/aadhaar|phone|dateOfBirth/i);
  });

  it('resolves role hashes to readable role names without storing labels on-ledger', async () => {
    const events = getCachedAuditFeed().filter((e) => e.type === 'ROLE_GRANTED');
    expect(events.length).toBeGreaterThan(0);
    expect(['Admin', 'Manager', 'Auditor', 'User']).toContain(events[0].target);
  });
});
