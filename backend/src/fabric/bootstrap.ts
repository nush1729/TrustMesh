/**
 * Genesis governance action — grants the first Admin role.
 *
 *   npx tsx src/fabric/bootstrap.ts <didHash> [role] [days]
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
 */
import { closeGateways } from './gateway';
import { proposeApproveExecute } from './governance.service';
import { ROLE_NAME_TO_HASH, ROLE_NAMES, RoleName } from './identity';

async function main() {
  const [didHash, roleArg = 'Admin', daysArg = '365'] = process.argv.slice(2);

  if (!didHash || !/^[a-f0-9]{64}$/i.test(didHash)) {
    console.error('usage: tsx src/fabric/bootstrap.ts <64-char didHash> [Admin|Manager|Auditor|User] [days]');
    process.exit(1);
  }
  const role = roleArg as RoleName;
  if (!ROLE_NAMES.includes(role)) {
    console.error(`role must be one of: ${ROLE_NAMES.join(', ')}`);
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
  await closeGateways();
}

main().catch(async (err) => {
  console.error(err.message);
  await closeGateways();
  process.exit(1);
});
