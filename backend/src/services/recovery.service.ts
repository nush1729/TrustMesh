import { v4 as uuidv4 } from "uuid";
import { query } from "../db/client";
import { didRegistry, relayerWallet } from "./chain.service";

/// Guardian-based social recovery. Guardians vote off-chain (collected
/// here); once the stored threshold is met, the backend relayer — which
/// must be set as DIDRegistry.recoveryModule by the Safe during setup —
/// submits the single on-chain updateController() call. No individual
/// guardian, and no admin, can re-bind a DID alone.

export async function addGuardian(didHash: string, guardianAddress: string) {
  await query(`INSERT INTO guardians (did_hash, guardian_address) VALUES ($1, $2)`, [didHash, guardianAddress]);
}

export async function listGuardians(didHash: string): Promise<string[]> {
  const rows = await query<{ guardian_address: string }>(`SELECT guardian_address FROM guardians WHERE did_hash = $1`, [
    didHash,
  ]);
  return rows.map((r) => r.guardian_address);
}

export async function proposeRecovery(didHash: string, proposedBy: string, newController: string) {
  const guardians = await listGuardians(didHash);
  if (guardians.length === 0) {
    throw new Error("No guardians registered for this DID — cannot propose recovery.");
  }
  if (!guardians.includes(proposedBy)) {
    throw new Error("Only a registered guardian may propose recovery.");
  }

  const threshold = Math.ceil(guardians.length / 2) + 1; // simple majority-plus-one, e.g. 2-of-3
  const id = uuidv4();
  await query(
    `INSERT INTO recovery_requests (id, did_hash, proposed_by, new_controller, votes, threshold, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
    [id, didHash, proposedBy, newController, [proposedBy], threshold]
  );
  return { requestId: id, threshold, votes: 1 };
}

export async function voteRecovery(requestId: string, guardianAddress: string) {
  const rows = await query<{
    id: string;
    did_hash: string;
    new_controller: string;
    votes: string[];
    threshold: number;
    status: string;
  }>(`SELECT * FROM recovery_requests WHERE id = $1`, [requestId]);
  const request = rows[0];
  if (!request) throw new Error("Recovery request not found.");
  if (request.status !== "pending") return { status: request.status, votes: request.votes.length };

  const guardians = await listGuardians(request.did_hash);
  if (!guardians.includes(guardianAddress)) throw new Error("Not a registered guardian for this DID.");

  const votes = Array.from(new Set([...request.votes, guardianAddress]));
  await query(`UPDATE recovery_requests SET votes = $1 WHERE id = $2`, [votes, requestId]);

  if (votes.length >= request.threshold) {
    if (!relayerWallet) throw new Error("CHAIN_PRIVATE_KEY not set — cannot execute recovery on-chain.");
    const data = didRegistry.interface.encodeFunctionData("updateController", [
      request.did_hash,
      request.new_controller,
    ]);
    const tx = await relayerWallet.sendTransaction({ to: await didRegistry.getAddress(), data });
    await tx.wait();
    await query(`UPDATE recovery_requests SET status = 'executed' WHERE id = $1`, [requestId]);
    return { status: "executed", votes: votes.length, txHash: tx.hash };
  }

  return { status: "pending", votes: votes.length, threshold: request.threshold };
}
