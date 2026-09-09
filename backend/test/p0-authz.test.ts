import * as crypto from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/server';
import { query } from '../src/db/client';
import { hashSessionToken } from '../src/utils/session-token';
import { readField, storeField } from '../src/services/vault.service';
import { requestOrApproveErasure } from '../src/services/erasure.service';
import { addGuardian, proposeRecovery, recoveryThreshold } from '../src/fabric/recovery.service';

/**
 * P0 AUTHORIZATION GUARANTEES — the regression suite that survives the EVM
 * retirement.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS, AND WHY IT NEEDS NO FABRIC NETWORK
 * ============================================================================
 *
 * The original P0.1/P0.2/P0.3 tests were deleted with the EVM stack. Their
 * subject matter was not EVM-specific: each one pins an AUTHORIZATION rule that
 * lives in Express middleware and route handlers, not in chaincode. Losing them
 * would have left three security fixes with no test on either stack.
 *
 * They are rewritten here against the Fabric backend, and deliberately kept
 * free of any ledger dependency so they run in CI with only Postgres — unlike
 * test/fabric/phase3-backend.test.ts, which needs a live 3-org network and
 * therefore never runs on a push.
 *
 * The trick that makes that possible: `requireSession` (fabric/auth.middleware)
 * authenticates purely by looking up a SHA-256 hash of the cookie in the
 * `sessions` table. Nothing about establishing a session touches the ledger.
 * So a test can insert a session row directly and present the matching cookie,
 * which exercises the real middleware and the real route handler while skipping
 * the signed-challenge flow that would need a ledger-held public key.
 *
 * Where a route's guard genuinely does reach the ledger (`/recovery/guardians`
 * re-checks the DID's current controller; `requireRole` evaluates chaincode),
 * the same guarantee is asserted one layer down at the service boundary, which
 * is where the rule actually lives. That is called out per-test below rather
 * than glossed over.
 */

// Unique per run so repeated local runs against a persistent database never
// collide on the users.did unique constraint or leave rows fighting each other.
const RUN = crypto.randomBytes(6).toString('hex');

interface Identity {
  didHash: string;
  did: string;
  publicKey: string;
}

function identity(label: string): Identity {
  return {
    didHash: crypto.createHash('sha256').update(`${label}-${RUN}`, 'utf8').digest('hex'),
    did: `did:key:zTest${label}${RUN}`,
    publicKey: `test-public-key-${label}-${RUN}`,
  };
}

async function seedUser(user: Identity) {
  await query(
    `INSERT INTO users (did_hash, did, wallet_address) VALUES ($1, $2, $3)
     ON CONFLICT (did_hash) DO NOTHING`,
    [user.didHash, user.did, user.publicKey]
  );
}

/** A real session row + the raw cookie value that resolves to it. */
async function seedSession(user: Identity): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await query(`INSERT INTO sessions (token, wallet_address, expires_at) VALUES ($1, $2, $3)`, [
    hashSessionToken(token),
    user.didHash,
    new Date(Date.now() + 60 * 60 * 1000),
  ]);
  return token;
}

const cookie = (token: string) => [`trustmesh_session=${token}`];

const victim = identity('victim');
const attacker = identity('attacker');
const erasureSubject = identity('erasure-subject');
const recoverySubject = identity('recovery-subject');
const soloSubject = identity('solo-subject');

const everyone = [victim, attacker, erasureSubject, recoverySubject, soloSubject];

beforeAll(async () => {
  for (const user of everyone) await seedUser(user);
}, 30_000);

afterAll(async () => {
  // Children before parents — every table below has a users(did_hash) FK.
  const hashes = everyone.map((u) => u.didHash);
  await query(
    `DELETE FROM erasure_audit_log WHERE erasure_request_id IN
       (SELECT id FROM erasure_requests WHERE did_hash = ANY($1))`,
    [hashes]
  );
  await query(`DELETE FROM erasure_requests WHERE did_hash = ANY($1)`, [hashes]);
  await query(`DELETE FROM recovery_requests WHERE did_hash = ANY($1)`, [hashes]);
  await query(`DELETE FROM notifications WHERE did_hash = ANY($1)`, [hashes]);
  await query(`DELETE FROM guardians WHERE did_hash = ANY($1)`, [hashes]);
  await query(`DELETE FROM pii_vault WHERE did_hash = ANY($1)`, [hashes]);
  await query(`DELETE FROM sessions WHERE wallet_address = ANY($1)`, [hashes]);
  await query(`DELETE FROM users WHERE did_hash = ANY($1)`, [hashes]);
  // Deliberately NOT calling pool.end(): the pool is a module-level singleton
  // shared by every test file, and vitest runs them sequentially in one fork
  // (see vitest.config.ts). Closing it here would break any Postgres-backed
  // file that happens to sort after this one.
}, 30_000);

/* ========================================================================== */

describe('P0.2 — PII vault poisoning via a body-supplied didHash', () => {
  /**
   * The attack: a logged-in attacker POSTs a VICTIM's didHash to
   * /identity/digilocker-import, hoping the handler trusts the body and writes
   * attacker-controlled document fields into the victim's vault record.
   *
   * The fix is that `didHash` is read from `req.didHash` (the session) and the
   * body value is ignored entirely — not sanitised, not merged, ignored.
   */
  it('ignores the body didHash and writes only under the caller’s own session identity', async () => {
    const token = await seedSession(attacker);

    const res = await request(app)
      .post('/identity/digilocker-import')
      .set('Cookie', cookie(token))
      .send({ didHash: victim.didHash, documentType: '10th Marksheet' });

    expect(res.status).toBe(200);

    // The victim's vault is untouched.
    expect(await readField(victim.didHash, 'student_name')).toBeNull();

    // And the write really did land under the ATTACKER's own identity, which
    // proves the request was re-targeted rather than silently dropped — a
    // dropped request would pass the assertion above for the wrong reason.
    expect(await readField(attacker.didHash, 'student_name')).toBe('Demo Student');
  });

  it('rejects the same request with no session at all', async () => {
    const res = await request(app)
      .post('/identity/digilocker-import')
      .send({ didHash: victim.didHash, documentType: '10th Marksheet' });

    expect(res.status).toBe(401);
    expect(await readField(victim.didHash, 'student_name')).toBeNull();
  });
});

/* ========================================================================== */

describe('P0.3 — DPDP erasure requires two distinct approvers', () => {
  /**
   * Asserted at the service boundary rather than over HTTP: the route is
   * `requireRole('Admin')`-gated, and that middleware evaluates chaincode, so
   * an HTTP-level test would need a live network. The two-approval rule itself
   * lives entirely in erasure.service.ts against Postgres, which is what these
   * assertions exercise.
   */
  beforeAll(async () => {
    await storeField(erasureSubject.didHash, 'student_name', 'Erasure Subject');
    await storeField(erasureSubject.didHash, 'roll_number', 'DEMO-10-0042');
  });

  it('does not erase on the first Admin request — the vault survives', async () => {
    const first = await requestOrApproveErasure(erasureSubject.didHash, 'admin-A', 'subject request');

    expect(first.status).toBe('pending');
    expect(first.approvals).toBe(1);
    expect(await readField(erasureSubject.didHash, 'student_name')).toBe('Erasure Subject');
  });

  it('does not let one Admin reach the threshold by calling twice', async () => {
    const repeat = await requestOrApproveErasure(erasureSubject.didHash, 'admin-A');

    expect(repeat.status).toBe('pending');
    expect(repeat.approvals).toBe(1); // still one, not two
    expect(await readField(erasureSubject.didHash, 'student_name')).toBe('Erasure Subject');
  });

  it('erases only once a SECOND, DISTINCT Admin approves, and logs the trail', async () => {
    const second = await requestOrApproveErasure(erasureSubject.didHash, 'admin-B');

    expect(second.status).toBe('executed');
    expect(second.approvals).toBe(2);
    expect(second.erasedRows).toBeGreaterThan(0);

    // Every field is gone, not just the one we happened to check.
    expect(await readField(erasureSubject.didHash, 'student_name')).toBeNull();
    expect(await readField(erasureSubject.didHash, 'roll_number')).toBeNull();

    // The audit trail must outlive the data it describes: once the ciphertext
    // is gone, this log is the only remaining evidence the erasure was
    // authorised rather than an unexplained data loss.
    const trail = await query<{ actor: string; action: string }>(
      `SELECT l.actor, l.action FROM erasure_audit_log l
       JOIN erasure_requests r ON r.id = l.erasure_request_id
       WHERE r.did_hash = $1 ORDER BY l.created_at`,
      [erasureSubject.didHash]
    );
    expect(trail.map((t) => t.action)).toEqual(['requested', 'approved', 'executed']);
    expect(trail[0].actor).toBe('admin-A');
    expect(trail[1].actor).toBe('admin-B');
  });
});

/* ========================================================================== */

describe('P0.1 — only a registered guardian may drive a recovery', () => {
  /**
   * The attack this closes: an attacker registers themselves as someone else's
   * guardian, then votes their own fraudulent recovery through to take over the
   * DID.
   *
   * `/recovery/guardians` additionally re-checks the DID's current controller
   * against the ledger, so the add path is not assertable without a network.
   * The decisive rule — that the PROPOSER is identified by their session and
   * must already be a registered guardian of the target DID — is enforced in
   * recovery.service.ts against Postgres, and is what these tests pin.
   */
  beforeAll(async () => {
    for (const g of ['guardian-1', 'guardian-2', 'guardian-3']) {
      await addGuardian(recoverySubject.didHash, `${g}-${RUN}`);
    }
  });

  it('refuses a proposal from someone who is not a guardian of that DID', async () => {
    await expect(
      proposeRecovery(recoverySubject.didHash, attacker.didHash, 'attacker-new-key')
    ).rejects.toThrow(/Only a registered guardian/);
  });

  it('refuses over HTTP too, identifying the proposer from the session not the body', async () => {
    const token = await seedSession(attacker);

    const res = await request(app)
      .post('/recovery/propose')
      .set('Cookie', cookie(token))
      .send({ didHash: recoverySubject.didHash, newControllerPublicKey: 'attacker-new-key' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only a registered guardian/);

    // Nothing was recorded against the victim's DID.
    const opened = await query(`SELECT id FROM recovery_requests WHERE did_hash = $1`, [
      recoverySubject.didHash,
    ]);
    expect(opened).toHaveLength(0);
  });

  it('allows a genuine guardian to propose (positive control)', async () => {
    const result = await proposeRecovery(
      recoverySubject.didHash,
      `guardian-1-${RUN}`,
      'legitimate-new-key'
    );

    expect(result.votes).toBe(1);
    // Three guardians -> strict majority of 2, NOT unanimity. See below.
    expect(result.threshold).toBe(2);
  });
});

/* ========================================================================== */

describe('recovery threshold — regression against the unanimity bug', () => {
  /**
   * This previously read `Math.ceil(n / 2) + 1`, described in its own comment
   * as "majority-plus-one (e.g. 2-of-3)". For three guardians that expression
   * yields 3 — unanimity — so a single unreachable guardian deadlocked recovery
   * permanently, which is the exact failure mode guardian recovery exists to
   * prevent. These cases pin the strict majority the comment always claimed.
   */
  it('is a strict majority, so three guardians means 2-of-3', () => {
    expect(recoveryThreshold(3)).toBe(2);
  });

  it('scales without ever requiring unanimity above two guardians', () => {
    expect(recoveryThreshold(2)).toBe(2);
    expect(recoveryThreshold(4)).toBe(3);
    expect(recoveryThreshold(5)).toBe(3);
    expect(recoveryThreshold(7)).toBe(4);

    // The property that matters: past two guardians, at least one may be
    // unreachable without bricking recovery.
    for (const n of [3, 4, 5, 6, 7]) {
      expect(recoveryThreshold(n)).toBeLessThan(n);
    }
  });

  it('hard-blocks a lone guardian instead of silently deadlocking', async () => {
    await addGuardian(soloSubject.didHash, `lonely-guardian-${RUN}`);

    await expect(
      proposeRecovery(soloSubject.didHash, `lonely-guardian-${RUN}`, 'new-key')
    ).rejects.toThrow(/at least 2 registered guardians/);
  });
});
