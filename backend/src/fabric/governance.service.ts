import { OrgKey, ORG_KEYS, fabricConfig } from './config';
import { CONTRACTS, evaluateJson, submitJson } from './gateway';

/**
 * GOVERNANCE CLIENT — the direct replacement for services/safe.service.ts.
 *
 * The old file proposed a transaction to a Gnosis Safe and returned a
 * `safeTxHash` the frontend polled for co-signer confirmations. This one
 * proposes an action to the Governance chaincode and returns a `proposalId`
 * with the same lifecycle: propose -> other organizations approve -> execute.
 *
 * API CONTRACT CHANGE (called out rather than made silently): callers now
 * receive `proposalId` where they previously received `safeTxHash`. The shape
 * and polling pattern are otherwise unchanged — one identifier, returned on
 * propose, used to query status until executed.
 *
 * What genuinely improves: an approval is now made by a whole ORGANIZATION's
 * MSP identity rather than a bare keypair on someone's laptop, and the same
 * write is independently endorsed by two organizations' peers at the platform
 * layer. What is deliberately unchanged: a named human still has to
 * consciously approve each specific action before it takes effect.
 */

export interface Approval {
  mspId: string;
  signer: string;
  approvedAt: string;
}

export interface Proposal {
  proposalId: string;
  actionType: string;
  params: Record<string, string>;
  proposedBy: string;
  proposedByMsp: string;
  proposedAt: string;
  threshold: number;
  approvals: Approval[];
  status: 'PENDING' | 'EXECUTED' | 'CANCELLED';
  executedAt: string;
  result: string;
}

export type ActionType =
  | 'GRANT_ROLE'
  | 'REVOKE_ROLE'
  | 'MINT_ASSET'
  | 'TRANSFER_ASSET'
  | 'UPDATE_CONTROLLER'
  | 'SET_CREDENTIAL_STATUS';

/**
 * Propose a privileged action. Mirrors proposeSafeTransaction().
 * Proposing implies the proposer's own approval, as it did with the Safe.
 */
export async function proposeAction(
  actionType: ActionType,
  params: Record<string, string | number>,
  org: OrgKey = fabricConfig.primaryOrg
): Promise<Proposal> {
  const stringParams = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return submitJson<Proposal>(
    CONTRACTS.GOVERNANCE,
    'ProposeAction',
    [actionType, JSON.stringify(stringParams)],
    org
  );
}

/** Record one organization's approval. The chaincode refuses a repeat from the same org. */
export async function approveProposal(proposalId: string, org: OrgKey): Promise<Proposal> {
  return submitJson<Proposal>(CONTRACTS.GOVERNANCE, 'ApproveProposal', [proposalId], org);
}

/** Execute once the threshold of distinct organizations is met. */
export async function executeProposal(
  proposalId: string,
  org: OrgKey = fabricConfig.primaryOrg
): Promise<Proposal> {
  return submitJson<Proposal>(CONTRACTS.GOVERNANCE, 'ExecuteProposal', [proposalId], org);
}

export async function cancelProposal(
  proposalId: string,
  org: OrgKey = fabricConfig.primaryOrg
): Promise<Proposal> {
  return submitJson<Proposal>(CONTRACTS.GOVERNANCE, 'CancelProposal', [proposalId], org);
}

export async function getProposal(proposalId: string): Promise<Proposal> {
  return evaluateJson<Proposal>(CONTRACTS.GOVERNANCE, 'GetProposal', [proposalId]);
}

export async function listPendingProposals(): Promise<Proposal[]> {
  return evaluateJson<Proposal[]>(CONTRACTS.GOVERNANCE, 'QueryPendingProposals', []);
}

/**
 * Status in the shape the old getSafeTransactionStatus() returned, so the
 * frontend's polling logic keeps the same fields.
 */
export async function getProposalStatus(proposalId: string) {
  const proposal = await getProposal(proposalId);
  const distinctOrgs = new Set(proposal.approvals.map((a) => a.mspId));
  return {
    proposalId,
    isExecuted: proposal.status === 'EXECUTED',
    status: proposal.status,
    confirmations: distinctOrgs.size,
    threshold: proposal.threshold,
    approvals: proposal.approvals,
    actionType: proposal.actionType,
    result: proposal.result,
  };
}

/**
 * DEMO AFFORDANCE — propose, gather the remaining approvals, execute, in one call.
 *
 * This is the honest analogue of the EVM stack's SAFE_LOCAL_MODE, which held
 * two Safe owner keys locally and executed the real on-chain 2-of-3 approval
 * itself rather than waiting for humans to click "Confirm" in the Safe UI.
 *
 * IMPORTANT — what this is NOT: it does not weaken or bypass the threshold.
 * Every approval below is a real, separately submitted, individually attributed
 * transaction signed by a different organization's MSP identity, and the
 * chaincode still refuses to execute without them. What is simulated is only
 * the human latency between them. In a real deployment each organization's own
 * backend calls approveProposal() when its officer approves, and this function
 * is not used.
 */
export async function proposeApproveExecute(
  actionType: ActionType,
  params: Record<string, string | number>
): Promise<Proposal> {
  const proposal = await proposeAction(actionType, params);
  const approved = new Set(proposal.approvals.map((a) => a.mspId));

  for (const key of ORG_KEYS) {
    if (approved.size >= proposal.threshold) break;
    const mspId = fabricConfig.orgs[key].mspId;
    if (approved.has(mspId)) continue;
    await approveProposal(proposal.proposalId, key);
    approved.add(mspId);
  }

  return executeProposal(proposal.proposalId);
}
