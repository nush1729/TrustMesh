import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/server.fabric';
import { closeGateways, pingChaincode } from '../../src/fabric/gateway';
import { startIndexer, stopIndexer } from '../../src/fabric/indexer.service';
import { bootstrapRole, loginAs, newCitizen, registerCitizen, TestCitizen } from './helpers';

/**
 * Overnight-pass regression suite — GET /audit/feed had no role check at
 * all beyond the global session gate: any authenticated citizen, including a
 * plain "User", could read the entire platform's audit feed. PS 26125
 * defines a dedicated Auditor role for exactly this purpose, so access is
 * now restricted to an active on-ledger Admin or Auditor role
 * (requireAnyRole(['Admin', 'Auditor']) in fabric/auth.middleware.ts).
 *
 * This suite proves, against the real running Fabric network (no mocks):
 *   (a) a plain User gets 403;
 *   (b) an Auditor gets 200;
 *   (c) an Admin gets 200;
 *   (d) an unauthenticated caller still gets 401 from the pre-existing
 *       global session gate (unchanged by this fix, asserted for completeness).
 */

let userCitizen: TestCitizen;
let userAgent: request.SuperAgentTest;
let auditorCitizen: TestCitizen;
let auditorAgent: request.SuperAgentTest;
let adminCitizen: TestCitizen;
let adminAgent: request.SuperAgentTest;

beforeAll(async () => {
  await pingChaincode();
  startIndexer();

  userCitizen = newCitizen();
  auditorCitizen = newCitizen();
  adminCitizen = newCitizen();
  await registerCitizen(app, userCitizen);
  await registerCitizen(app, auditorCitizen);
  await registerCitizen(app, adminCitizen);

  await bootstrapRole('User', userCitizen.didHash);
  await bootstrapRole('Auditor', auditorCitizen.didHash);
  await bootstrapRole('Admin', adminCitizen.didHash, undefined, 'org1');

  userAgent = await loginAs(app, userCitizen);
  auditorAgent = await loginAs(app, auditorCitizen);
  adminAgent = await loginAs(app, adminCitizen);
}, 180_000);

afterAll(async () => {
  stopIndexer();
  await closeGateways();
});

describe('V8: GET /audit/feed is restricted to Admin/Auditor', () => {
  it('(a) a plain User gets 403, not the audit feed', async () => {
    const res = await userAgent.get('/audit/feed');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin|Auditor/i);
  });

  it('(b) an Auditor gets 200 with the feed', async () => {
    const res = await auditorAgent.get('/audit/feed');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it('(c) an Admin gets 200 with the feed', async () => {
    const res = await adminAgent.get('/audit/feed');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it('(d) an unauthenticated caller still gets 401 (pre-existing global session gate)', async () => {
    const res = await request(app).get('/audit/feed');
    expect(res.status).toBe(401);
  });
});
