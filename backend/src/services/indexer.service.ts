import { didRegistry, revocationRegistry, accessControlRegistry, assetNFT, provider } from "./chain.service";

/// Reads events directly from the four TrustMesh contracts and turns them
/// into a flat, chronological, PII-free audit feed. Deliberately reads only
/// what the contracts emit (addresses, hashes, token ids) — there is no PII
/// on-chain to leak in the first place, so this indexer can be public.

export type AuditEvent = {
  id: string;
  type: "DID_REGISTERED" | "ROLE_GRANTED" | "ROLE_REVOKED" | "ASSET_MINTED" | "ASSET_TRANSFERRED" | "CREDENTIAL_REVOKED";
  actor: string;
  target: string;
  timestamp: string;
  txHash: string;
};

let cache: AuditEvent[] = [];
let lastScannedBlock = 0;

async function blockTimestamp(blockNumber: number): Promise<string> {
  const block = await provider.getBlock(blockNumber);
  return new Date((block?.timestamp ?? 0) * 1000).toISOString();
}

export async function refreshAuditFeed(): Promise<void> {
  const latest = await provider.getBlockNumber();
  const fromBlock = lastScannedBlock === 0 ? Math.max(0, latest - 50_000) : lastScannedBlock + 1;
  if (fromBlock > latest) return;

  const [didEvents, roleGrants, roleRevokes, mints, transfers, statusChanges] = await Promise.all([
    didRegistry.queryFilter(didRegistry.filters.DIDRegistered(), fromBlock, latest),
    accessControlRegistry.queryFilter(accessControlRegistry.filters.RoleGrantedWithExpiry(), fromBlock, latest),
    accessControlRegistry.queryFilter(accessControlRegistry.filters.RoleRevokedEarly(), fromBlock, latest),
    assetNFT.queryFilter(assetNFT.filters.AssetMinted(), fromBlock, latest),
    assetNFT.queryFilter(assetNFT.filters.AssetTransferred(), fromBlock, latest),
    revocationRegistry.queryFilter(revocationRegistry.filters.StatusChanged(), fromBlock, latest),
  ]);

  const newEvents: AuditEvent[] = [];

  for (const e of didEvents) {
    if (!("args" in e)) continue;
    newEvents.push({
      id: `${e.transactionHash}-${e.index}`,
      type: "DID_REGISTERED",
      actor: e.args.controller,
      target: e.args.didHash,
      timestamp: await blockTimestamp(e.blockNumber),
      txHash: e.transactionHash,
    });
  }

  for (const e of roleGrants) {
    if (!("args" in e)) continue;
    newEvents.push({
      id: `${e.transactionHash}-${e.index}`,
      type: "ROLE_GRANTED",
      actor: e.args.account,
      target: e.args.role,
      timestamp: await blockTimestamp(e.blockNumber),
      txHash: e.transactionHash,
    });
  }

  for (const e of roleRevokes) {
    if (!("args" in e)) continue;
    newEvents.push({
      id: `${e.transactionHash}-${e.index}`,
      type: "ROLE_REVOKED",
      actor: e.args.account,
      target: e.args.role,
      timestamp: await blockTimestamp(e.blockNumber),
      txHash: e.transactionHash,
    });
  }

  for (const e of mints) {
    if (!("args" in e)) continue;
    newEvents.push({
      id: `${e.transactionHash}-${e.index}`,
      type: "ASSET_MINTED",
      actor: e.args.to,
      target: `tokenId:${e.args.tokenId}`,
      timestamp: await blockTimestamp(e.blockNumber),
      txHash: e.transactionHash,
    });
  }

  for (const e of transfers) {
    if (!("args" in e)) continue;
    newEvents.push({
      id: `${e.transactionHash}-${e.index}`,
      type: "ASSET_TRANSFERRED",
      actor: e.args.from,
      target: e.args.to,
      timestamp: await blockTimestamp(e.blockNumber),
      txHash: e.transactionHash,
    });
  }

  for (const e of statusChanges) {
    if (!("args" in e) || !e.args.revoked) continue;
    newEvents.push({
      id: `${e.transactionHash}-${e.index}`,
      type: "CREDENTIAL_REVOKED",
      actor: "revocation-registry",
      target: e.args.statusId,
      timestamp: await blockTimestamp(e.blockNumber),
      txHash: e.transactionHash,
    });
  }

  cache = [...newEvents, ...cache].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  lastScannedBlock = latest;
}

export function getCachedAuditFeed(): AuditEvent[] {
  return cache;
}

export function startIndexerPolling(intervalMs = 15_000) {
  refreshAuditFeed().catch((err) => console.error("Indexer initial refresh failed:", err));
  setInterval(() => {
    refreshAuditFeed().catch((err) => console.error("Indexer refresh failed:", err));
  }, intervalMs);
}
