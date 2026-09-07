import { query } from '../db/client';
import { ORG_KEYS, OrgKey } from './config';

/**
 * ORG MEMBERSHIP — which organization an authenticated admin approves *as*.
 *
 * TM-01. The governance threshold counts DISTINCT ORGANIZATIONS, so the whole
 * 2-of-3 control rests on one question: who decides which organization a given
 * approval belongs to? Until this file existed, the answer was "the caller,
 * in the request body" — which meant a single compromised Admin session could
 * approve a proposal twice, once as `org1` and once as `org2`, and execute it
 * alone. The cross-institutional separation of duties was decorative.
 *
 * The binding now lives server-side, keyed by the session-derived DID hash and
 * never by anything the client sends. `org_admins` (db/schema.sql) is written
 * only by the genesis bootstrap path, matching how the founding Admin role is
 * itself granted out-of-band when the network is stood up.
 *
 * This does not, and cannot, make the prototype's colocated-identity topology
 * into the production one: all three MSP identities still live in one process,
 * so a compromised BACKEND still holds all three. What it removes is the far
 * weaker precondition — a compromised or merely careless *user session* being
 * enough. In production each organization runs its own backend and this table
 * degenerates to a single row.
 */

interface OrgAdminRow {
  org_key: OrgKey;
}

/**
 * The organization this DID is entitled to approve governance proposals as.
 * Throws rather than defaulting: an unmapped admin must be refused, never
 * silently attributed to the primary org (that would reintroduce TM-01 by
 * letting two different unmapped admins both count as `org1` — or worse, let
 * one count as an org they have no relationship with).
 */
export async function getOrgForDidHash(didHash: string): Promise<OrgKey> {
  const rows = await query<OrgAdminRow>(`SELECT org_key FROM org_admins WHERE did_hash = $1`, [didHash]);
  const org = rows[0]?.org_key;
  if (!org) {
    throw new Error(
      'This identity is not registered as an administrator of any governance organization, so it cannot approve proposals.'
    );
  }
  if (!ORG_KEYS.includes(org)) {
    throw new Error(`org_admins holds an unknown org_key '${org}' for this identity.`);
  }
  return org;
}

/**
 * Bind a DID to a governance organization. Called only from the genesis
 * bootstrap script — there is deliberately no HTTP route for this, because a
 * route that lets admins hand out org membership would let one org manufacture
 * the second approver it needs.
 */
export async function assignOrgToDid(didHash: string, org: OrgKey): Promise<void> {
  if (!ORG_KEYS.includes(org)) {
    throw new Error(`org must be one of: ${ORG_KEYS.join(', ')}`);
  }
  await query(
    `INSERT INTO org_admins (did_hash, org_key) VALUES ($1, $2)
     ON CONFLICT (did_hash) DO UPDATE SET org_key = EXCLUDED.org_key, assigned_at = now()`,
    [didHash, org]
  );
}
