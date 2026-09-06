import { getCachedAuditFeed } from './indexer.service';
import { getProposal } from './governance.service';
import { ROLE_NAME_TO_HASH, RoleName } from './identity';
import { subjectsByRole } from './registry.service';

/**
 * Item 4 (public transparency dashboard).
 *
 * Everything here is PII-free by construction — the same property the audit
 * indexer already relies on (§8/§9): every field is a hash, a count, or a
 * timestamp, never a name or document. Nothing is fabricated; every number
 * is either a live CouchDB rich-query read (role counts) or derived from the
 * durable, checkpointed audit feed / a direct ledger read of the governance
 * record (proposal counts and timing) — see indexer.service.ts for why the
 * feed itself is safe to expose publicly.
 *
 * WHY NOT A "QueryAllAssets"/"QueryAllProposals" CHAINCODE FUNCTION: neither
 * AssetNFT nor Governance expose an unscoped "list everything" query (only
 * QueryAssetsByOwner / QueryPendingProposals), and adding one would mean a
 * chaincode change + redeploy to the live 3-org network. The audit feed
 * already captures every ASSET_MINTED and every governance lifecycle event
 * durably, so it is used as the source for those two instead — genuinely
 * live ledger-derived data, just read from the indexer's cache rather than a
 * new on-chain query.
 */

export interface TransparencyStats {
  /** Currently active (granted, unexpired) role counts, read live per role type. */
  activeRolesByType: Record<RoleName, number>;
  /** Total assets ever minted, from the durable audit feed's ASSET_MINTED events. */
  totalAssetsMinted: number;
  governance: {
    /** Every proposal ever created (from PROPOSAL_CREATED events). */
    totalProposals: number;
    /** Reached its approval threshold and executed. */
    executedProposals: number;
    /** Still pending, or cancelled (the audit feed does not distinguish the two — see note below). */
    pendingOrCancelledProposals: number;
    /** Mean wall-clock time between proposal and execution, across executed proposals. Null if none yet. */
    avgTimeToApprovalMs: number | null;
  };
  generatedAt: string;
}

/**
 * A proposal's real `proposedAt`/`executedAt` come from a direct ledger read
 * (GetProposal), not from the audit feed's own `timestamp` field: the
 * ProposalCreated/ProposalApproved chaincode events carry the full
 * ProposalRecord (whose time field is `proposedAt`/`approvedAt`, not
 * `timestamp`), so the generic indexer falls back to the epoch for those two
 * event types specifically. Reading the ledger record directly sidesteps
 * that rather than reporting a fabricated/wrong duration.
 */
async function timeToApprovalMs(proposalId: string): Promise<number | null> {
  try {
    const proposal = await getProposal(proposalId);
    if (proposal.status !== 'EXECUTED' || !proposal.executedAt || !proposal.proposedAt) return null;
    const delta = new Date(proposal.executedAt).getTime() - new Date(proposal.proposedAt).getTime();
    return delta >= 0 ? delta : null;
  } catch {
    return null;
  }
}

export async function computeTransparencyStats(): Promise<TransparencyStats> {
  const roleNames = Object.keys(ROLE_NAME_TO_HASH) as RoleName[];
  const now = Date.now();

  const roleEntries = await Promise.all(
    roleNames.map(async (name) => {
      const records = await subjectsByRole(name);
      // subjectsByRole already filters granted=true on-ledger; only expiry is
      // left to check here for "currently active" rather than "ever granted".
      // `expiry` is a unix timestamp in SECONDS (matching the chaincode's
      // Solidity-derived signature — see registry.ts), not an ISO string.
      const active = records.filter((r) => Number(r.expiry) * 1000 > now).length;
      return [name, active] as const;
    })
  );
  const activeRolesByType = Object.fromEntries(roleEntries) as Record<RoleName, number>;

  const feed = getCachedAuditFeed();
  const totalAssetsMinted = feed.filter((e) => e.type === 'ASSET_MINTED').length;

  const proposedIds = new Set<string>();
  const executedIds = new Set<string>();
  for (const e of feed) {
    const pid = e.governance?.proposalId;
    if (!pid) continue;
    if (e.type === 'PROPOSAL_CREATED') proposedIds.add(pid);
    else if (e.type !== 'PROPOSAL_APPROVED') executedIds.add(pid); // the dispatched domain event = execution
  }

  const deltas = (
    await Promise.all(Array.from(executedIds).map((id) => timeToApprovalMs(id)))
  ).filter((d): d is number => d !== null);

  const totalProposals = proposedIds.size;
  const executedProposals = Array.from(executedIds).filter((id) => proposedIds.has(id)).length;

  return {
    activeRolesByType,
    totalAssetsMinted,
    governance: {
      totalProposals,
      executedProposals,
      pendingOrCancelledProposals: Math.max(totalProposals - executedProposals, 0),
      avgTimeToApprovalMs: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null,
    },
    generatedAt: new Date().toISOString(),
  };
}
