/**
 * Genesis governance action — grants the first Admin role.
 *
 *   npx tsx src/fabric/bootstrap.ts <didHash> [role] [days] [org]
 *
 * Breaks the chicken-and-egg that the /roles routes create: proposing a role
 * grant requires an active Admin role, but at genesis nobody has one.
 *
 * This is NOT a backdoor. It runs the identical propose -> approve -> execute
 * path every other governed action takes, so the grant is still a real 2-of-3
 * multi-organization approval, recorded on the ledger with named approvers.
 * What it bypasses is only the HTTP layer's requireRole('Admin') gate — which
 * is exactly what a real deployment's founding organizations would do
 * out-of-band when standing the network up.
 *
 * It is also the ONLY place governance org membership is seeded (TM-01). An
 * Admin granted here is bound to `org` in the `org_admins` table, which is
 * what /governance/approve derives the approving organization from. There is
 * no HTTP route for this on purpose: an admin who could assign org membership
 * could manufacture the second approver a 2-of-3 threshold requires.
 */
import { pool } from '../db/client';
import { closeGateways } from './gateway';
import { ORG_KEYS, OrgKey } from './config';
import { proposeApproveExecute } from './governance.service';
import { ROLE_NAME_TO_HASH, ROLE_NAMES, RoleName } from './identity';
import { assignOrgToDid } from './org-membership.service';

async function main() {
  const [didHash, roleArg = 'Admin', daysArg = '365', orgArg = 'org1'] = process.argv.slice(2);

  if (!didHash || !/^[a-f0-9]{64}$/i.test(didHash)) {
    console.error(
      'usage: tsx src/fabric/bootstrap.ts <64-char didHash> [Admin|Manager|Auditor|User] [days] [org1|org2|org3]'
    );
    process.exit(1);
  }
  const role = roleArg as RoleName;
  if (!ROLE_NAMES.includes(role)) {
    console.error(`role must be one of: ${ROLE_NAMES.join(', ')}`);
    process.exit(1);
  }
  const org = orgArg as OrgKey;
  if (!ORG_KEYS.includes(org)) {
    console.error(`org must be one of: ${ORG_KEYS.join(', ')}`);
    process.exit(1);
  }

  const expiry = Math.floor(Date.now() / 1000) + Number(daysArg) * 24 * 60 * 60;
  console.log(`Proposing ${role} for ${didHash} (expires in ${daysArg} days)…`);

  const proposal = await proposeApproveExecute('GRANT_ROLE', {
    roleId: ROLE_NAME_TO_HASH[role],
    subject: didHash,
    expiry,
  });

  console.log(`  status:    ${proposal.status}`);
  console.log(`  proposal:  ${proposal.proposalId}`);
  for (const a of proposal.approvals) {
    console.log(`  approved by ${a.signer} (${a.mspId})`);
  }

  // Only an Admin can approve governance proposals, so only an Admin needs the
  // org binding. Seeding it for any other role would put a row in `org_admins`
  // that /governance/approve could never reach — misleading rather than useful.
  if (role === 'Admin' && proposal.status === 'EXECUTED') {
    await assignOrgToDid(didHash, org);
    console.log(`  governance org: ${org} (recorded in org_admins)`);
  }

  await closeGateways();
  // The org binding above opens a Postgres pool; without closing it the script
  // would hang instead of exiting once the grant is done.
  await pool.end();
}

main().catch(async (err) => {
  console.error(err.message);
  await closeGateways();
  await pool.end().catch(() => undefined);
  process.exit(1);
});
