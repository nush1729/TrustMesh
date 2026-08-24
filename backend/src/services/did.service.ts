import { ethers } from "ethers";
import { query } from "../db/client";
import { didRegistry } from "./chain.service";

export function buildDid(address: string): { did: string; didHash: string } {
  const did = `did:ethr:80002:${ethers.getAddress(address)}`;
  const didHash = ethers.keccak256(ethers.toUtf8Bytes(did));
  return { did, didHash };
}

/// Registering the DID on-chain (DIDRegistry.registerDID) must happen from
/// the USER'S OWN wallet — the contract binds msg.sender as the controller,
/// which is exactly the self-sovereign guarantee we want. The frontend
/// calls that directly via wagmi/viem. This service records the off-chain
/// side (the `users` row role labels and PII get attached to) once that
/// on-chain call has gone through, and best-effort verifies it landed.
export async function registerUser(address: string): Promise<{ did: string; didHash: string; onChainConfirmed: boolean }> {
  const { did, didHash } = buildDid(address);

  let onChainConfirmed = false;
  try {
    const controller = await didRegistry.getController(didHash);
    onChainConfirmed = controller.toLowerCase() === address.toLowerCase();
  } catch {
    onChainConfirmed = false; // not registered on-chain yet — fine, frontend will retry the read
  }

  await query(
    `INSERT INTO users (did_hash, did, wallet_address)
     VALUES ($1, $2, $3)
     ON CONFLICT (did_hash) DO NOTHING`,
    [didHash, did, address]
  );

  return { did, didHash, onChainConfirmed };
}

export async function getUserByDidHash(didHash: string) {
  const rows = await query<{ did_hash: string; did: string; wallet_address: string }>(
    `SELECT * FROM users WHERE did_hash = $1`,
    [didHash]
  );
  return rows[0] ?? null;
}
