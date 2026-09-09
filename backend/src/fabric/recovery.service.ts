import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/client';
import { proposeApproveExecute } from './governance.service';
import { notifyRecoveryExecuted, notifyRecoveryProposed, notifyRecoveryVote } from './notifications.service';

/**
 * Guardian-based social recovery — replaces services/recovery.service.ts.
 *
 * The off-chain guardian voting is unchanged (same Postgres tables, same
 * threshold arithmetic, and the same Stage 1 P0.1 protections in the routes:
 * a guardian may only be added for the caller's OWN DID, verified against the
 * ledger's current controller).
 *
 * What changed is the final step. The EVM version ended with
 * `relayerWallet.sendTransaction(...)` calling DIDRegistry.updateController —
 * a SINGLE backend key re-binding an identity to a new controller. That key
 * had to be registered as the contract's `recoveryModule`, making it a
 * standing, unilateral identity-rewrite capability.
 *
 * On Fabric that unilateral path does not exist: UPDATE_CONTROLLER is a
 * governed action, so re-binding an identity now requires the same 2-of-3
 * multi-organization approval as granting a role or minting an asset, and is
 * individually attributed in the audit trail. A compromised backend can no
 * longer silently take over an identity even with every guardian record
 * forged. That is a structural improvement over the EVM design, not a port.
 */

/// Minimum guardians before a recovery may be proposed at all.
///
/// The previous code relied on the threshold arithmetic producing an
/// unreachable number for a single guardian: a lone guardian could open a
/// recovery that could never execute. The protection was right — one guardian
/// is one person able to unilaterally rebind a DID — but expressing it as an
/// accident of rounding meant the caller got a request stuck at "pending"
/// forever instead of a reason. This rejects the case explicitly.
const MIN_GUARDIANS = 2;

/// Strict majority: 2-of-3, 3-of-4, 3-of-5.
///
/// This previously read `Math.ceil(n / 2) + 1`, described in the comment as
/// "majority-plus-one (e.g. 2-of-3, 3-of-4)". It is neither: for 3 guardians
/// it yields 3, i.e. UNANIMITY, so one unreachable guardian deadlocked
/// recovery permanently — the same brick failure mode guardian recovery
/// exists to prevent. `floor(n / 2) + 1` is the strict majority the comment
/// always described.
export function recoveryThreshold(guardianCount: number): number {
  return Math.floor(guardianCount / 2) + 1;
}

export async function addGuardian(didHash: string, guardianId: string) {
  await query(`INSERT INTO guardians (did_hash, guardian_address) VALUES ($1, $2)`, [didHash, guardianId]);
}

export async function listGuardians(didHash: string): Promise<string[]> {
  const rows = await query<{ guardian_address: string }>(
    `SELECT guardian_address FROM guardians WHERE did_hash = $1`,
    [didHash]
  );
  return rows.map((r) => r.guardian_address);
}

export async function proposeRecovery(didHash: string, proposedBy: string, newControllerPublicKey: string) {
  const guardians = await listGuardians(didHash);
  if (guardians.length < MIN_GUARDIANS) {
    throw new Error(
      `Recovery needs at least ${MIN_GUARDIANS} registered guardians for this DID — found ${guardians.length}.`
    );
  }
  if (!guardians.includes(proposedBy)) {
    throw new Error('Only a registered guardian may propose recovery.');
  }

  const threshold = recoveryThreshold(guardians.length);
  const id = uuidv4();
  await query(
    `INSERT INTO recovery_requests (id, did_hash, proposed_by, new_controller, votes, threshold, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
    [id, didHash, proposedBy, newControllerPublicKey, [proposedBy], threshold]
  );

  // Item 1 (guardian notifications): alert the actual DID owner the moment a
  // recovery is opened against their identity, before any further votes can
  // land. Awaited so the notification is guaranteed durable by the time this
  // call returns (useful for demos/tests), but a notification failure must
  // never fail the recovery proposal itself, so errors are swallowed here.
  await notifyRecoveryProposed(didHash, proposedBy, id).catch((err) =>
    console.error('[notifications] failed to notify recovery-proposed:', (err as Error).message)
  );

  return { requestId: id, threshold, votes: 1 };
}

export async function voteRecovery(requestId: string, guardianId: string) {
  const rows = await query<{
    id: string;
    did_hash: string;
    new_controller: string;
    votes: string[];
    threshold: number;
    status: string;
  }>(`SELECT * FROM recovery_requests WHERE id = $1`, [requestId]);
  const request = rows[0];
  if (!request) throw new Error('Recovery request not found.');
  if (request.status !== 'pending') return { status: request.status, votes: request.votes.length };

  const guardians = await listGuardians(request.did_hash);
  if (!guardians.includes(guardianId)) throw new Error('Not a registered guardian for this DID.');

  const votes = Array.from(new Set([...request.votes, guardianId]));
  await query(`UPDATE recovery_requests SET votes = $1 WHERE id = $2`, [votes, requestId]);

  // Item 1: every vote — not just the one that reaches threshold — alerts the
  // real DID owner, so a hijack-in-progress is visible as it accumulates
  // votes rather than only once it is too late to stop.
  await notifyRecoveryVote(request.did_hash, guardianId, votes.length, request.threshold).catch((err) =>
    console.error('[notifications] failed to notify recovery-vote:', (err as Error).message)
  );

  if (votes.length >= request.threshold) {
    // Guardian threshold met off-chain; the on-chain re-binding is still a
    // governed, multi-organization action rather than a single key's write.
    const proposal = await proposeApproveExecute('UPDATE_CONTROLLER', {
      didHash: request.did_hash,
      newControllerPublicKey: request.new_controller,
    });
    await query(`UPDATE recovery_requests SET status = 'executed' WHERE id = $1`, [requestId]);
    await notifyRecoveryExecuted(request.did_hash, proposal.proposalId).catch((err) =>
      console.error('[notifications] failed to notify recovery-executed:', (err as Error).message)
    );
    return { status: 'executed', votes: votes.length, proposalId: proposal.proposalId };
  }

  return { status: 'pending', votes: votes.length, threshold: request.threshold };
}
