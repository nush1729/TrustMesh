import { query } from '../db/client';
import { CONTRACTS, evaluate, evaluateJson, submitJson } from './gateway';
import { didKeyFromPublicKey, didToHash, isDidKey, isValidPublicKey, verifySignature } from './identity';

/**
 * DID service — the Fabric replacement for services/did.service.ts.
 *
 * The EVM version built `did:ethr:80002:<address>` from a wallet address and
 * only *observed* the on-chain registration, because the frontend called
 * DIDRegistry.registerDID() directly from the user's wallet. Under §4's design
 * there is no browser wallet submitting transactions, so the backend submits
 * the registration itself — and the citizen's consent is carried by a
 * proof-of-possession signature the chaincode verifies, rather than by
 * msg.sender. See did.contract.ts for why that matters.
 */

export interface DidRecord {
  didHash: string;
  did: string;
  controllerPublicKey: string;
  registeredAt: string;
  updatedAt: string;
}

/** Derives the did:key identifier and ledger hash for a citizen public key. */
export function buildDid(publicKeyB64: string): { did: string; didHash: string } {
  const did = didKeyFromPublicKey(publicKeyB64);
  return { did, didHash: didToHash(did) };
}

/**
 * Registers a citizen's DID on the ledger and records the off-chain row that
 * role labels and vault entries hang off.
 *
 * The Postgres `users` table is unchanged (its schema is out of scope for this
 * migration): `wallet_address` now carries the citizen's base64 public key
 * instead of an 0x address. The column name is now a misnomer, but renaming it
 * would mean a schema change, so the semantic shift is documented here and in
 * docs/API.md rather than done silently.
 */
export async function registerUser(
  publicKeyB64: string,
  signatureB64: string
): Promise<{ did: string; didHash: string; onChainConfirmed: boolean }> {
  if (!isValidPublicKey(publicKeyB64)) {
    throw new Error('publicKey must be a base64 SPKI DER ECDSA P-256 public key');
  }
  const { did, didHash } = buildDid(publicKeyB64);

  // Fail fast with a clear message rather than letting the chaincode's
  // proof-of-possession check produce an opaque endorsement error.
  if (!verifySignature(publicKeyB64, did, signatureB64)) {
    throw new Error('signature does not prove possession of the private key for this public key');
  }

  await submitJson<{ didHash: string }>(CONTRACTS.DID_REGISTRY, 'RegisterDID', [
    did,
    publicKeyB64,
    signatureB64,
  ]);

  await query(
    `INSERT INTO users (did_hash, did, wallet_address)
     VALUES ($1, $2, $3)
     ON CONFLICT (did_hash) DO NOTHING`,
    [didHash, did, publicKeyB64]
  );

  return { did, didHash, onChainConfirmed: true };
}

export async function didExists(didHash: string): Promise<boolean> {
  return (await evaluate(CONTRACTS.DID_REGISTRY, 'DIDExists', [didHash])) === 'true';
}

/** The DID's CURRENT controlling public key — the login challenge is verified against this. */
export async function getController(didHash: string): Promise<string> {
  return evaluate(CONTRACTS.DID_REGISTRY, 'GetController', [didHash]);
}

export async function getDidRecord(didHash: string): Promise<DidRecord> {
  return evaluateJson<DidRecord>(CONTRACTS.DID_REGISTRY, 'GetDID', [didHash]);
}

export async function getUserByDidHash(didHash: string) {
  const rows = await query<{ did_hash: string; did: string; wallet_address: string }>(
    `SELECT * FROM users WHERE did_hash = $1`,
    [didHash]
  );
  return rows[0] ?? null;
}

/** Resolves a did:key string, or a raw DID hash, to a DID hash. */
export function resolveDidHash(didOrHash: string): string {
  if (isDidKey(didOrHash)) return didToHash(didOrHash);
  if (/^[a-f0-9]{64}$/i.test(didOrHash)) return didOrHash.toLowerCase();
  throw new Error('Expected a did:key identifier or a 64-character DID hash');
}
