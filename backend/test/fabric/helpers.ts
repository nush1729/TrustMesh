import * as crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import { didKeyFromPublicKey, didToHash, ROLE_NAME_TO_HASH, RoleName } from '../../src/fabric/identity';
import { proposeApproveExecute } from '../../src/fabric/governance.service';

/**
 * Test helpers for the Fabric stack.
 *
 * A "citizen" here is exactly what the browser will hold under the §4 WebCrypto
 * design: an ECDSA P-256 keypair, a did:key derived from it, and signatures in
 * the raw r||s form WebCrypto emits. Nothing is stubbed — these are real keys
 * producing real signatures that the real chaincode verifies.
 */

export interface TestCitizen {
  did: string;
  didHash: string;
  publicKeyB64: string;
  privateKey: crypto.KeyObject;
  sign(message: string): string;
}

export function newCitizen(): TestCitizen {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const did = didKeyFromPublicKey(publicKeyB64);
  return {
    did,
    didHash: didToHash(did),
    publicKeyB64,
    privateKey,
    // ieee-p1363 = raw r||s, matching WebCrypto. Node's default DER would be
    // rejected by both the chaincode and the backend verifier.
    sign: (message: string) =>
      crypto
        .sign('sha256', Buffer.from(message, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' })
        .toString('base64'),
  };
}

/** Registers a citizen's DID through the real HTTP route. */
export async function registerCitizen(app: Express, citizen: TestCitizen) {
  const res = await request(app)
    .post('/identity/did')
    .send({ publicKey: citizen.publicKeyB64, signature: citizen.sign(citizen.did) });
  if (res.status !== 200) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { did: string; didHash: string };
}

/**
 * Full signed-challenge login against the app, mirroring exactly what the
 * frontend will do. Returns an agent carrying the session cookie.
 */
export async function loginAs(app: Express, citizen: TestCitizen) {
  const agent = request.agent(app);
  const challenge = await agent.post('/auth/challenge').send({ did: citizen.did });
  if (challenge.status !== 200) {
    throw new Error(`challenge failed: ${challenge.status} ${JSON.stringify(challenge.body)}`);
  }
  const { nonce } = challenge.body as { nonce: string };
  const signature = citizen.sign(`TrustMesh DID challenge: ${nonce}`);

  const verify = await agent.post('/auth/verify').send({ did: citizen.did, signature, nonce });
  if (verify.status !== 200) {
    throw new Error(`verify failed: ${verify.status} ${JSON.stringify(verify.body)}`);
  }
  return agent;
}

/**
 * Grants a role through the governance chaincode directly, at the service
 * layer, bypassing the HTTP routes.
 *
 * This is the GENESIS governance action — the bootstrap that breaks the
 * chicken-and-egg of "only an Admin can propose a role grant, but nobody is
 * an Admin yet". It is not a backdoor: it still goes through
 * proposeApproveExecute, so it is still a real 2-of-3 multi-organization
 * approval recorded on the ledger with attributed approvers. What it skips is
 * only the HTTP layer's requireRole('Admin') gate, which is exactly what a
 * real deployment's founding organizations would do out-of-band.
 */
export async function bootstrapRole(roleName: RoleName, subjectDidHash: string, ttlSeconds = 365 * 24 * 60 * 60) {
  await proposeApproveExecute('GRANT_ROLE', {
    roleId: ROLE_NAME_TO_HASH[roleName],
    subject: subjectDidHash,
    expiry: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
}
