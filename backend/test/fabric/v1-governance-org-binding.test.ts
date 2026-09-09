import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/server.fabric';
import { closeGateways, pingChaincode } from '../../src/fabric/gateway';
import { hasActiveRole } from '../../src/fabric/registry.service';
import { startIndexer, stopIndexer } from '../../src/fabric/indexer.service';
import { query } from '../../src/db/client';
import { bootstrapRole, loginAs, newCitizen, registerCitizen, TestCitizen } from './helpers';

/**
 * V1 REGRESSION SUITE — governance quorum bypass (security audit, §11/V1).
 *
 * Root cause: backend/src/fabric/config.ts colocates all three organizations'
 * real MSP identities in one process, and POST /governance/approve used to
 * accept a client-supplied `org` body field with nothing binding the
 * authenticated session to a specific organization. Live exploit: a single
 * Admin session proposed a role grant (auto-approved as org1), then called
 * /governance/approve again with `org: 'org2'` — using the SAME session — and
 * single-handedly satisfied the chaincode's 2-of-3 quorum.
 *
 * The fix (fabric/org-membership.service.ts + governance.routes.ts): the
 * approving org is now looked up server-side from an `org_admins` row keyed
 * by the caller's own req.didHash, assigned only out-of-band via
 * fabric/bootstrap.ts. The request body's `org` field, if present, is now
 * ignored entirely.
 *
 * This suite proves, against the real running Fabric network (no mocks):
 *   (a) a session with an org1 affiliation cannot approve as org2, even if
 *       it tries to (by sending an `org` override that is simply ignored);
 *   (b) a session with NO affiliation is rejected outright, with 403;
 *   (c) the legitimate flow — two DIFFERENT sessions, each with a distinct
 *       real org affiliation — still reaches quorum and executes.
 */

let orgOneAdmin: TestCitizen;
let orgOneAgent: request.SuperAgentTest;
let orgTwoAdmin: TestCitizen;
let orgTwoAgent: request.SuperAgentTest;

beforeAll(async () => {
  await pingChaincode();
  startIndexer();

  orgOneAdmin = newCitizen();
  orgTwoAdmin = newCitizen();
  await registerCitizen(app, orgOneAdmin);
  await registerCitizen(app, orgTwoAdmin);

  // Two distinct Admins, each bound to a distinct organization — exactly what
  // fabric/bootstrap.ts requires of any real Admin provisioning.
  await bootstrapRole('Admin', orgOneAdmin.didHash, undefined, 'org1');
  await bootstrapRole('Admin', orgTwoAdmin.didHash, undefined, 'org2');

  orgOneAgent = await loginAs(app, orgOneAdmin);
  orgTwoAgent = await loginAs(app, orgTwoAdmin);
}, 180_000);

afterAll(async () => {
  stopIndexer();
  await closeGateways();
});

describe('V1: governance quorum can no longer be satisfied by one session', () => {
  it('(a) a session bound to org1 cannot approve as org2, even sending org2 in the body', async () => {
    const subject = newCitizen();
    await registerCitizen(app, subject);

    const grant = await orgOneAgent
      .post('/roles/grant')
      .send({ role: 'Manager', subject: subject.didHash, expiry: Math.floor(Date.now() / 1000) + 3600 });
    expect(grant.status).toBe(200);
    const { proposalId } = grant.body as { proposalId: string };

    // Proposing auto-approved as org1. The SAME org1-bound session now tries
    // to supply the second approval by asking for org2 in the body — the
    // server must ignore that and resolve org1 again from the session,
    // which the chaincode then correctly rejects as a duplicate-org approval.
    const forgedApprove = await orgOneAgent.post('/governance/approve').send({ proposalId, org: 'org2' });
    expect(forgedApprove.status).toBe(400);

    const exec = await orgOneAgent.post('/governance/execute').send({ proposalId });
    expect(exec.status).toBe(400);
    expect(await hasActiveRole('Manager', subject.didHash)).toBe(false);
  });

  it('(b) a session with no recorded org affiliation is rejected with 403, not silently defaulted', async () => {
    const unaffiliated = newCitizen();
    await registerCitizen(app, unaffiliated);
    // Grants the Admin role on-ledger WITHOUT ever assigning an org — the
    // exact "provisioned wrong / provisioned incompletely" case the fix must
    // still refuse, not silently default to some org.
    await bootstrapRole('Admin', unaffiliated.didHash);
    await query('DELETE FROM org_admins WHERE did_hash = $1', [unaffiliated.didHash]);
    const unaffiliatedAgent = await loginAs(app, unaffiliated);

    const grant = await orgOneAgent
      .post('/roles/grant')
      .send({ role: 'User', subject: unaffiliated.didHash, expiry: Math.floor(Date.now() / 1000) + 3600 });
    const { proposalId } = grant.body as { proposalId: string };

    const res = await unaffiliatedAgent.post('/governance/approve').send({ proposalId });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/organization affiliation|not provisioned/i);
  });

  it('(c) two genuinely different, correctly-affiliated sessions still reach quorum and execute', async () => {
    const subject = newCitizen();
    await registerCitizen(app, subject);

    const grant = await orgOneAgent
      .post('/roles/grant')
      .send({ role: 'Auditor', subject: subject.didHash, expiry: Math.floor(Date.now() / 1000) + 3600 });
    expect(grant.status).toBe(200);
    const { proposalId } = grant.body as { proposalId: string };
    expect(await hasActiveRole('Auditor', subject.didHash)).toBe(false);

    const secondApproval = await orgTwoAgent.post('/governance/approve').send({ proposalId });
    expect(secondApproval.status).toBe(200);

    const exec = await orgOneAgent.post('/governance/execute').send({ proposalId });
    expect(exec.status).toBe(200);
    expect(await hasActiveRole('Auditor', subject.didHash)).toBe(true);
  });
});
