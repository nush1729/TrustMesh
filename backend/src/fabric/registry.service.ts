import { CONTRACTS, evaluate, evaluateJson } from './gateway';
import { ROLE_NAME_TO_HASH, RoleName, statusIdFor } from './identity';

/**
 * Read-side client for the three non-governance registries.
 *
 * Every function here is a ledger read. Nothing in this file can change state —
 * all mutations go through governance.service.ts, which is the only path to the
 * chaincode's privileged functions.
 */

export interface RoleRecord {
  roleId: string;
  subject: string;
  grantedAt: string;
  expiry: string;
  granted: boolean;
}

export interface AssetRecord {
  assetId: string;
  owner: string;
  ipfsCID: string;
  contentHash: string;
  mintedAt: string;
  updatedAt: string;
}

// --- AccessControlRegistry --------------------------------------------------------

/**
 * The live RBAC check — granted, unexpired and unrevoked, read from ledger
 * state rather than a database flag or a session claim. This is what
 * roleGate.middleware re-checks on every privileged request.
 */
export async function hasActiveRole(roleName: RoleName, subjectDidHash: string): Promise<boolean> {
  return (
    (await evaluate(CONTRACTS.ACCESS_CONTROL_REGISTRY, 'HasActiveRole', [
      ROLE_NAME_TO_HASH[roleName],
      subjectDidHash,
    ])) === 'true'
  );
}

/** Every role name currently active for an identity. */
export async function activeRolesFor(subjectDidHash: string): Promise<RoleName[]> {
  const names = Object.keys(ROLE_NAME_TO_HASH) as RoleName[];
  const checks = await Promise.all(names.map(async (n) => ({ n, active: await hasActiveRole(n, subjectDidHash) })));
  return checks.filter((c) => c.active).map((c) => c.n);
}

export async function getRole(roleName: RoleName, subjectDidHash: string): Promise<RoleRecord> {
  return evaluateJson<RoleRecord>(CONTRACTS.ACCESS_CONTROL_REGISTRY, 'GetRole', [
    ROLE_NAME_TO_HASH[roleName],
    subjectDidHash,
  ]);
}

/** CouchDB rich query — every grant held by one identity, expired ones included. */
export async function rolesBySubject(subjectDidHash: string): Promise<RoleRecord[]> {
  return evaluateJson<RoleRecord[]>(CONTRACTS.ACCESS_CONTROL_REGISTRY, 'QueryRolesBySubject', [subjectDidHash]);
}

/** CouchDB rich query — everyone currently holding a given role. */
export async function subjectsByRole(roleName: RoleName): Promise<RoleRecord[]> {
  return evaluateJson<RoleRecord[]>(CONTRACTS.ACCESS_CONTROL_REGISTRY, 'QuerySubjectsByRole', [
    ROLE_NAME_TO_HASH[roleName],
  ]);
}

export function roleStatusId(roleName: RoleName, subjectDidHash: string): string {
  return statusIdFor(ROLE_NAME_TO_HASH[roleName], subjectDidHash);
}

// --- RevocationRegistry -----------------------------------------------------------

export async function isRevoked(statusId: string): Promise<boolean> {
  return (await evaluate(CONTRACTS.REVOCATION_REGISTRY, 'IsRevoked', [statusId])) === 'true';
}

export async function isExpired(statusId: string): Promise<boolean> {
  return (await evaluate(CONTRACTS.REVOCATION_REGISTRY, 'IsExpired', [statusId])) === 'true';
}

export async function getStatus(statusId: string) {
  return evaluateJson<{ statusId: string; revoked: boolean; expiry: string; updatedAt: string }>(
    CONTRACTS.REVOCATION_REGISTRY,
    'GetStatus',
    [statusId]
  );
}

// --- AssetNFT ----------------------------------------------------------------------

export async function getAsset(assetId: string): Promise<AssetRecord> {
  return evaluateJson<AssetRecord>(CONTRACTS.ASSET_NFT, 'GetAsset', [assetId]);
}

export async function getAssetOwner(assetId: string): Promise<string> {
  return evaluate(CONTRACTS.ASSET_NFT, 'GetAssetOwner', [assetId]);
}

export async function assetExists(assetId: string): Promise<boolean> {
  return (await evaluate(CONTRACTS.ASSET_NFT, 'AssetExists', [assetId])) === 'true';
}

/**
 * CouchDB rich query — all assets owned by one identity.
 *
 * The EVM prototype could not do this: AssetNFT.sol did not implement
 * ERC721Enumerable, so verify.routes.ts reconstructed ownership by replaying
 * cached mint/transfer events, with a comment admitting a production version
 * would need a proper indexed owner map. On Fabric with CouchDB this is a
 * direct, authoritative state query — a real capability gain from the
 * migration, not just a port.
 */
export async function assetsByOwner(ownerDidHash: string): Promise<AssetRecord[]> {
  return evaluateJson<AssetRecord[]>(CONTRACTS.ASSET_NFT, 'QueryAssetsByOwner', [ownerDidHash]);
}

/** Immutable custody history for an asset, from the ledger's own key history. */
export async function assetHistory(assetId: string) {
  return evaluateJson<Array<{ txId: string; timestamp: string; isDelete: boolean; value: AssetRecord | null }>>(
    CONTRACTS.ASSET_NFT,
    'GetAssetHistory',
    [assetId]
  );
}
