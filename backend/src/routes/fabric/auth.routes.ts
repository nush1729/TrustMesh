import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/client';
import { getController } from '../../fabric/did.service';
import { didToHash, isDidKey, verifySignature } from '../../fabric/identity';
import { generateSessionToken, hashSessionToken } from '../../utils/session-token';

export const authRouter = Router();

/**
 * Signed-challenge login — the same pattern as the EVM version, checked
 * against a different store (§4: "unchanged in security properties, just
 * checked against a different store").
 *
 * EVM:    nonce -> personal_sign -> ethers.verifyMessage recovers an address
 *                -> compare to the claimed address
 * Fabric: nonce -> WebCrypto ECDSA P-256 sign -> verify against the public key
 *                the LEDGER records as this DID's current controller
 *
 * The Fabric version is strictly stronger on one point: signature recovery on
 * EVM proves control of whatever key signed, and the address is then compared
 * to a caller-supplied claim. Here the verification key is fetched from the
 * ledger by DID, so a caller cannot present their own key and claim it belongs
 * to someone else — there is nothing to substitute.
 *
 * ============================================================================
 * API CONTRACT CHANGE
 *   POST /auth/challenge  { address }                  -> { did }
 *   POST /auth/verify     { address, signature, nonce } -> { did, signature, nonce }
 * `signature` is now base64 raw r||s from WebCrypto, not a 0x hex eth signature.
 * Route paths, method and response shapes are unchanged.
 * ============================================================================
 */

// Stage 1 P1.2: nonces expire, closing an otherwise unbounded replay window.
const NONCE_TTL_MS = 5 * 60 * 1000;

authRouter.post('/challenge', async (req, res) => {
  const { did } = req.body as { did?: string };
  if (!did || !isDidKey(did)) {
    return res.status(400).json({ error: 'A valid did:key identifier is required.' });
  }

  const nonce = `TrustMesh login nonce: ${uuidv4()} @ ${new Date().toISOString()}`;
  // `wallet_address` stores the DID hash post-migration — the Postgres schema
  // is out of scope for this migration, so the column keeps its old name.
  await query(`INSERT INTO auth_nonces (nonce, wallet_address) VALUES ($1, $2)`, [nonce, didToHash(did)]);
  res.json({ nonce });
});

authRouter.post('/verify', async (req, res) => {
  const { did, signature, nonce } = req.body as { did?: string; signature?: string; nonce?: string };
  if (!did || !signature || !nonce) {
    return res.status(400).json({ error: 'did, signature, nonce required.' });
  }
  if (!isDidKey(did)) return res.status(400).json({ error: 'did must be a did:key identifier.' });

  const didHash = didToHash(did);

  const rows = await query<{ nonce: string; wallet_address: string; used: boolean; created_at: string }>(
    `SELECT * FROM auth_nonces WHERE nonce = $1`,
    [nonce]
  );
  const record = rows[0];
  if (!record || record.used || record.wallet_address !== didHash) {
    return res.status(401).json({ error: 'Invalid or already-used nonce.' });
  }
  if (Date.now() - new Date(record.created_at).getTime() > NONCE_TTL_MS) {
    return res.status(401).json({ error: 'Nonce expired — request a new challenge.' });
  }

  // The verification key comes from the LEDGER, not from the request. A DID
  // whose controller has been rotated or recovered immediately stops accepting
  // the old key, with no cache to invalidate.
  let controllerPublicKey: string;
  try {
    controllerPublicKey = await getController(didHash);
  } catch {
    return res.status(401).json({ error: 'DID is not registered — register it before logging in.' });
  }

  const message = `TrustMesh DID challenge: ${nonce}`;
  if (!verifySignature(controllerPublicKey, message, signature)) {
    return res.status(401).json({ error: 'Signature does not match the DID’s registered controller key.' });
  }

  await query(`UPDATE auth_nonces SET used = true WHERE nonce = $1`, [nonce]);

  // Stage 1 P1.2: the client's token is a CSPRNG value; only its hash persists.
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await query(`INSERT INTO sessions (token, wallet_address, expires_at) VALUES ($1, $2, $3)`, [
    hashSessionToken(token),
    didHash,
    expiresAt,
  ]);

  res.cookie('trustmesh_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
  });
  res.json({ sessionToken: token, did, didHash });
});

/**
 * Ends the session. Deletes the server-side row rather than only clearing the
 * cookie, so a token captured earlier cannot be replayed after logout.
 */
authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.trustmesh_session;
  if (token) {
    await query(`DELETE FROM sessions WHERE token = $1`, [hashSessionToken(token)]);
  }
  res.clearCookie('trustmesh_session');
  res.json({ ok: true });
});
