import { NextFunction, Request, Response } from 'express';
import { query } from '../db/client';
import { hashSessionToken } from '../utils/session-token';
import { RoleName } from './identity';
import { hasActiveRole } from './registry.service';

/**
 * Session and role middleware — replaces middleware/didAuth.middleware.ts and
 * middleware/roleGate.middleware.ts.
 *
 * ============================================================================
 * API CONTRACT CHANGE: req.walletAddress -> req.didHash / req.did
 * ============================================================================
 *
 * The migration proposal's §4 anticipated this: "every backend route currently
 * trusting req.walletAddress (treat it as 'the verified public-key
 * identifier', semantically unchanged)". There is no Ethereum address in this
 * system any more, so carrying a field named walletAddress would be actively
 * misleading. The authenticated principal is now the citizen's DID hash — the
 * same thing the ledger keys identity, roles and asset ownership on.
 *
 * The SECURITY property is unchanged: the value is still derived solely from
 * the server-side session, never from the request body. Every Stage 1 P0 fix
 * that depended on that (P0.1 recovery hijack, P0.2 record poisoning) holds
 * identically here, and the routes below re-derive from req.didHash for
 * exactly the same reason.
 *
 * The Postgres `sessions` table is NOT changed (its schema is out of scope for
 * this migration): the existing `wallet_address` column now stores the DID
 * hash. The column name is a misnomer post-migration; that is deliberate and
 * documented rather than fixed with a schema change.
 */

export interface AuthedRequest extends Request {
  /** The authenticated citizen's DID hash — the ledger's identity key. */
  didHash?: string;
  /** The did:key identifier, when the session carries it. */
  did?: string;
}

/**
 * Verifies the session cookie set by POST /auth/verify, which issues one only
 * after a valid signed-challenge against the DID's ledger-recorded public key.
 * No passwords anywhere in this system.
 *
 * Stage 1 P1.2 is preserved: the cookie carries the raw token, but only its
 * SHA-256 hash is ever looked up, so the table never stores a directly-usable
 * token.
 */
export async function requireSession(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.trustmesh_session;
  if (!token) return res.status(401).json({ error: 'No session. Complete the signed-DID challenge first.' });

  const rows = await query<{ wallet_address: string; expires_at: string }>(
    `SELECT wallet_address, expires_at FROM sessions WHERE token = $1`,
    [hashSessionToken(token)]
  );
  const session = rows[0];
  if (!session || new Date(session.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Session expired or invalid.' });
  }

  req.didHash = session.wallet_address;
  next();
}

/**
 * Gates a route on a LIVE LEDGER role check — never a database flag — so the
 * API cannot be tricked into allowing something the chaincode would reject.
 * Behaviourally identical to the EVM roleGate; only the state it reads moved.
 */
export function requireRole(roleName: RoleName) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.didHash) return res.status(401).json({ error: 'Not authenticated.' });

    const active = await hasActiveRole(roleName, req.didHash);
    if (!active) {
      return res.status(403).json({ error: `Requires an active on-ledger ${roleName} role.` });
    }
    next();
  };
}
