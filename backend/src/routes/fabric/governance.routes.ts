import { Router } from 'express';
import { ORG_KEYS, fabricConfig } from '../../fabric/config';
import { AuthedRequest, requireRole } from '../../fabric/auth.middleware';
import { getOrgForDidHash } from '../../fabric/org-membership.service';
import {
  approveProposal,
  cancelProposal,
  executeProposal,
  getProposal,
  listPendingProposals,
} from '../../fabric/governance.service';

export const governanceRouter = Router();

/**
 * NEW ROUTE GROUP — /governance
 *
 * This surface did not exist on the EVM stack because its equivalent lived
 * OUTSIDE the application: co-signers approved Safe transactions in the
 * Safe{Wallet} web UI, and the backend only proposed and polled. Fabric has no
 * hosted approval UI, so the approval step becomes first-class API surface
 * here (migration proposal §6 Phase 4, "whichever governance UI model results
 * from the §3 decision").
 *
 * Every endpoint maps to a §3 application-layer governance operation.
 * Approvals remain individually attributable: the chaincode records the
 * approving organization's MSP ID and the signing certificate's CN.
 */

/** The approval queue — pending proposals awaiting a second organization. */
governanceRouter.get('/pending', async (_req, res) => {
  res.json({ proposals: await listPendingProposals() });
});

/** The three governance organizations and the role each plays (§3 signer mapping). */
governanceRouter.get('/signers', (_req, res) => {
  res.json({
    threshold: 2,
    organizations: ORG_KEYS.map((k) => ({
      org: k,
      mspId: fabricConfig.orgs[k].mspId,
      role: fabricConfig.orgs[k].role,
    })),
  });
});

governanceRouter.get('/:proposalId', async (req, res) => {
  try {
    res.json(await getProposal(req.params.proposalId));
  } catch {
    res.status(404).json({ error: 'Unknown proposal.' });
  }
});

/**
 * One organization's approval.
 *
 * TM-01. Which organization's MSP identity signs is derived from the SESSION,
 * never from the request body. It used to be an `org` field the caller chose,
 * which meant one authenticated Admin could approve the same proposal as
 * `org1` and then again as `org2` and single-handedly clear a threshold whose
 * entire purpose is that two separate institutions must consent. The chaincode
 * rejects a repeat approval from the same MSP, so it faithfully enforced
 * "two distinct orgs" — the backend was simply lying to it about which org was
 * calling. The binding now lives in `org_admins`, seeded out-of-band at
 * genesis (see fabric/bootstrap.ts and fabric/org-membership.service.ts).
 *
 * In production each organization runs its own backend holding only its own
 * identity, and the question this lookup answers does not arise; the prototype
 * colocates all three so the full 2-of-3 flow is demonstrable on one machine
 * (see fabric/config.ts).
 */
governanceRouter.post('/approve', requireRole('Admin'), async (req: AuthedRequest, res) => {
  const { proposalId } = req.body as { proposalId?: string };
  if (!proposalId) return res.status(400).json({ error: 'proposalId required.' });
  try {
    const org = await getOrgForDidHash(req.didHash!);
    res.json(await approveProposal(proposalId, org));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * Execute an already-thresholded proposal.
 *
 * Deliberately left on `executeProposal`'s default (`fabricConfig.primaryOrg`):
 * unlike /approve, execution grants no consent and adds no approval — the
 * chaincode re-counts distinct approving MSPs itself and refuses to dispatch
 * below threshold. Any valid identity may submit that transaction, so there is
 * nothing here for a caller-chosen org to subvert.
 */
governanceRouter.post('/execute', requireRole('Admin'), async (req: AuthedRequest, res) => {
  const { proposalId } = req.body as { proposalId?: string };
  if (!proposalId) return res.status(400).json({ error: 'proposalId required.' });
  try {
    res.json(await executeProposal(proposalId));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

governanceRouter.post('/cancel', requireRole('Admin'), async (req: AuthedRequest, res) => {
  const { proposalId } = req.body as { proposalId?: string };
  if (!proposalId) return res.status(400).json({ error: 'proposalId required.' });
  try {
    res.json(await cancelProposal(proposalId));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
