import { query } from '../db/client';
import { OrgKey, ORG_KEYS } from './config';

/**
 * TM-01 FIX — binds an authenticated Admin's DID to the ONE Fabric
 * organization they are entitled to act as when approving/executing
 * governance proposals.
 *
 * WHY THIS EXISTS. The backend colocates all three organizations' Fabric MSP
 * identities in one process — a documented single-machine demo affordance
 * (see fabric/config.ts). Before this file existed, `POST /governance/approve`
 * read an `org` field straight from the request body and used it to pick
 * which of those three identities submitted the approval transaction. The
 * only gate on that route was `requireRole('Admin')` — a single on-ledger
 * role check against the CALLER'S OWN DID, with no relationship whatsoever to
 * organizational membership. Any one Admin could therefore call `/approve`
 * twice with two different `org` values and single-handedly satisfy the 2-of-3
 * quorum — collapsing "no single admin can act alone" down to exactly that.
 *
 * This table and the two functions below are what closes it: an Admin's
 * organization is now a fact recorded server-side, at the moment they are
 * provisioned as that organization's representative (currently only via
 * `fabric/bootstrap.ts`, the same genesis path that already grants the first
 * Admin role out-of-band) — never a value the caller supplies per-request.
 *
 * This does not change the chaincode's own threshold logic (already correct
 * — it counts distinct MSP IDs). It closes the HTTP-layer gap that let a
 * single identity choose which distinct MSP ID to submit as.
 */

/**
 * Distinguishes "this DID has no recorded org affiliation" (an authorization
 * problem — the caller isn't entitled to approve anything at all, a 403) from
 * every other failure in this module (a 400/500). governance.routes.ts checks
 * for this class specifically so the two don't collapse into the same status
 * code.
 */
export class NoOrgAffiliationError extends Error {}

export async function getOrgForDidHash(didHash: string): Promise<OrgKey> {
  const rows = await query<{ org_key: OrgKey }>(
    `SELECT org_key FROM org_admins WHERE did_hash = $1`,
    [didHash]
  );
  const row = rows[0];
  if (!row) {
    throw new NoOrgAffiliationError(
      'This identity is not provisioned with an organization affiliation — no organization affiliation assigned. ' +
        'Contact an existing admin to assign one via fabric/bootstrap.ts.'
    );
  }
  return row.org_key;
}

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

export async function getOrgAssignment(didHash: string): Promise<OrgKey | null> {
  const rows = await query<{ org_key: OrgKey }>(
    `SELECT org_key FROM org_admins WHERE did_hash = $1`,
    [didHash]
  );
  return rows[0]?.org_key ?? null;
}
