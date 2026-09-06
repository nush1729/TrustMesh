import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import { ACTION_TYPES, ActionType, Approval, DOC_TYPE, ProposalRecord } from './types';
import {
  callerMsp,
  callerSigner,
  getState,
  proposalKey,
  putState,
  requireArg,
  stableStringify,
  txTimestamp,
} from './util';
import * as registry from './registry';

/**
 * GOVERNANCE — the application half of the migration proposal's §3 hybrid design.
 *
 * This is the direct replacement for the Gnosis Safe. It preserves the exact
 * property the Final Solution's pitch rests on: a privileged action is
 * PROPOSED by one named signer and does not take effect until a threshold of
 * OTHER named signers, from different organizations, have each consciously
 * submitted their own approval transaction. No single admin key grants a role
 * or mints an asset.
 *
 * The §3 design layers two independent mechanisms, and it is worth being
 * precise about which one this file is:
 *
 *   1. THIS FILE — application layer. Human, individually attributable
 *      approvals: 2-of-3 named signers, each from a separate organization.
 *      Answers "did a specific person consciously authorize this specific
 *      action?" Preserved functionally unchanged from the Safe design.
 *
 *   2. THE ENDORSEMENT POLICY — platform layer, configured at chaincode
 *      deployment (see fabric/deploy-chaincode.sh), not in this file. Requires
 *      that multiple organizations' peers independently endorse the write
 *      itself. Answers "could one compromised org's infrastructure forge this
 *      state, including the approval bookkeeping above?"
 *
 * Layer 1 without layer 2 could be corrupted by a single compromised peer
 * writing directly to proposal state. Layer 2 without layer 1 is
 * infrastructure auto-validating, with no moment where a named human approves.
 * Together they are a strict improvement over what Solidity + Safe could offer,
 * which had layer 1 only.
 */

/**
 * 2-of-3, matching the EVM Safe's threshold and §3's signer/organization
 * mapping (Org1MSP=IssuingDept, Org2MSP=AuditOrg, Org3MSP=IndependentVerifier).
 *
 * The threshold counts DISTINCT ORGANIZATIONS, not distinct certificates:
 * two officials inside the same department must not be able to satisfy a
 * control whose entire purpose is cross-institutional separation of duties.
 */
export const GOVERNANCE_THRESHOLD = 2;

/** Required params per action, validated at propose time rather than at execute time. */
const REQUIRED_PARAMS: Record<ActionType, string[]> = {
  GRANT_ROLE: ['roleId', 'subject', 'expiry'],
  REVOKE_ROLE: ['roleId', 'subject'],
  MINT_ASSET: ['owner', 'ipfsCID', 'contentHash'],
  TRANSFER_ASSET: ['assetId', 'from', 'to'],
  UPDATE_CONTROLLER: ['didHash', 'newControllerPublicKey'],
  SET_CREDENTIAL_STATUS: ['statusId', 'revoked'],
};

@Info({ title: 'Governance', description: 'Application-level multi-party approval for all privileged TrustMesh actions' })
export class GovernanceContract extends Contract {
  constructor() {
    super('Governance');
  }

  /**
   * Propose a privileged action. Returns the proposal, whose id the frontend
   * polls — the same shape the Safe flow used, where the backend received a
   * safeTxHash to poll for co-signer confirmations.
   *
   * The proposer's own approval is recorded immediately, mirroring the Safe
   * design where proposing implies signing. A 2-of-3 proposal therefore needs
   * exactly one further organization to approve.
   */
  @Transaction()
  @Returns('string')
  public async ProposeAction(ctx: Context, actionType: string, paramsJson: string): Promise<string> {
    requireArg('actionType', actionType);
    if (!ACTION_TYPES.includes(actionType as ActionType)) {
      throw new Error(`Governance: unknown actionType '${actionType}'`);
    }
    const action = actionType as ActionType;

    let params: Record<string, string>;
    try {
      params = JSON.parse(requireArg('paramsJson', paramsJson));
    } catch {
      throw new Error('Governance: paramsJson is not valid JSON');
    }
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
      throw new Error('Governance: paramsJson must be a JSON object');
    }
    for (const key of REQUIRED_PARAMS[action]) {
      if (params[key] === undefined || String(params[key]).trim() === '') {
        throw new Error(`Governance: ${action} requires param '${key}'`);
      }
    }

    // The transaction id is the proposal id: unique, and identical on every
    // endorsing peer. A random id would break endorsement (see util.ts).
    const proposalId = ctx.stub.getTxID();
    const now = txTimestamp(ctx);
    const proposer: Approval = { mspId: callerMsp(ctx), signer: callerSigner(ctx), approvedAt: now };

    const proposal: ProposalRecord = {
      docType: DOC_TYPE.PROPOSAL,
      proposalId,
      actionType: action,
      params,
      proposedBy: proposer.signer,
      proposedByMsp: proposer.mspId,
      proposedAt: now,
      threshold: GOVERNANCE_THRESHOLD,
      approvals: [proposer],
      status: 'PENDING',
      executedAt: '',
      result: '',
    };

    await putState(ctx, proposalKey(ctx, proposalId), proposal);
    ctx.stub.setEvent('ProposalCreated', Buffer.from(stableStringify(proposal)));
    return stableStringify(proposal);
  }

  /**
   * Record one organization's approval.
   *
   * Rejects a second approval from an organization that has already approved —
   * without this, one org could satisfy a 2-of-3 threshold by submitting twice,
   * which would silently reduce the control to 1-of-3.
   */
  @Transaction()
  @Returns('string')
  public async ApproveProposal(ctx: Context, proposalId: string): Promise<string> {
    const proposal = await this.mustGetProposal(ctx, requireArg('proposalId', proposalId));
    if (proposal.status !== 'PENDING') {
      throw new Error(`Governance: proposal is ${proposal.status}, cannot approve`);
    }
    const mspId = callerMsp(ctx);
    if (proposal.approvals.some((a) => a.mspId === mspId)) {
      throw new Error(`Governance: organization ${mspId} has already approved this proposal`);
    }
    proposal.approvals.push({ mspId, signer: callerSigner(ctx), approvedAt: txTimestamp(ctx) });
    await putState(ctx, proposalKey(ctx, proposalId), proposal);
    ctx.stub.setEvent('ProposalApproved', Buffer.from(stableStringify(proposal)));
    return stableStringify(proposal);
  }

  /**
   * Execute an approved proposal — the ONLY path to any privileged state change
   * in this chaincode (see the header comment in registry.ts).
   */
  @Transaction()
  @Returns('string')
  public async ExecuteProposal(ctx: Context, proposalId: string): Promise<string> {
    const proposal = await this.mustGetProposal(ctx, requireArg('proposalId', proposalId));
    if (proposal.status !== 'PENDING') {
      throw new Error(`Governance: proposal is already ${proposal.status}`);
    }

    const distinctOrgs = new Set(proposal.approvals.map((a) => a.mspId));
    if (distinctOrgs.size < proposal.threshold) {
      throw new Error(
        `Governance: ${distinctOrgs.size} of ${proposal.threshold} required approvals — cannot execute`
      );
    }

    const event = await this.dispatch(ctx, proposal);

    proposal.status = 'EXECUTED';
    proposal.executedAt = txTimestamp(ctx);
    proposal.result = stableStringify(event.payload);
    await putState(ctx, proposalKey(ctx, proposalId), proposal);

    // Fabric allows exactly one event per transaction, so the DOMAIN event wins
    // over a generic "ProposalExecuted": it is what the audit indexer needs.
    // The governance metadata rides along in the payload so the audit feed can
    // still show who proposed and who approved.
    ctx.stub.setEvent(
      event.name,
      Buffer.from(
        stableStringify({
          ...event.payload,
          proposalId: proposal.proposalId,
          actionType: proposal.actionType,
          proposedBy: proposal.proposedBy,
          approvals: proposal.approvals,
        })
      )
    );
    return stableStringify(proposal);
  }

  /**
   * Cancel a pending proposal. Restricted to the proposing organization, so one
   * org cannot silently kill another's pending action.
   */
  @Transaction()
  @Returns('string')
  public async CancelProposal(ctx: Context, proposalId: string): Promise<string> {
    const proposal = await this.mustGetProposal(ctx, requireArg('proposalId', proposalId));
    if (proposal.status !== 'PENDING') {
      throw new Error(`Governance: proposal is already ${proposal.status}`);
    }
    if (callerMsp(ctx) !== proposal.proposedByMsp) {
      throw new Error('Governance: only the proposing organization may cancel');
    }
    proposal.status = 'CANCELLED';
    await putState(ctx, proposalKey(ctx, proposalId), proposal);
    ctx.stub.setEvent('ProposalCancelled', Buffer.from(stableStringify(proposal)));
    return stableStringify(proposal);
  }

  @Transaction(false)
  @Returns('string')
  public async GetProposal(ctx: Context, proposalId: string): Promise<string> {
    return stableStringify(await this.mustGetProposal(ctx, requireArg('proposalId', proposalId)));
  }

  /**
   * Pending proposals awaiting approval — what the admin console's approval
   * queue renders. A CouchDB rich query, which is why the state database must
   * be CouchDB and not LevelDB (§9, "Rich lookups").
   */
  @Transaction(false)
  @Returns('string')
  public async QueryPendingProposals(ctx: Context): Promise<string> {
    const query = { selector: { docType: DOC_TYPE.PROPOSAL, status: 'PENDING' } };
    const iterator = await ctx.stub.getQueryResult(JSON.stringify(query));
    const results: ProposalRecord[] = [];
    for (let res = await iterator.next(); !res.done; res = await iterator.next()) {
      results.push(JSON.parse(res.value.value.toString()) as ProposalRecord);
    }
    await iterator.close();
    results.sort((a, b) => (a.proposedAt < b.proposedAt ? 1 : -1));
    return stableStringify(results);
  }

  // --- internals ---------------------------------------------------------------

  private async mustGetProposal(ctx: Context, proposalId: string): Promise<ProposalRecord> {
    const proposal = await getState<ProposalRecord>(ctx, proposalKey(ctx, proposalId));
    if (!proposal) throw new Error(`Governance: unknown proposal ${proposalId}`);
    return proposal;
  }

  private async dispatch(ctx: Context, proposal: ProposalRecord): Promise<registry.DomainEvent> {
    const p = proposal.params;
    switch (proposal.actionType) {
      case 'GRANT_ROLE':
        return registry.grantRoleWithExpiry(ctx, p.roleId, p.subject, p.expiry);
      case 'REVOKE_ROLE':
        return registry.revokeRoleEarly(ctx, p.roleId, p.subject);
      case 'MINT_ASSET':
        return registry.mintAsset(ctx, p.owner, p.ipfsCID, p.contentHash);
      case 'TRANSFER_ASSET':
        return registry.transferAsset(ctx, p.assetId, p.from, p.to);
      case 'UPDATE_CONTROLLER':
        return registry.updateController(ctx, p.didHash, p.newControllerPublicKey);
      case 'SET_CREDENTIAL_STATUS':
        return registry.setStatus(ctx, p.statusId, String(p.revoked) === 'true', p.expiry);
      default:
        throw new Error(`Governance: no dispatch for ${proposal.actionType}`);
    }
  }
}
