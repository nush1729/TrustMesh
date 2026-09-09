import { Router } from 'express';
import { ORG_KEYS, fabricConfig } from '../../fabric/config';
import { AuthedRequest, requireRole } from '../../fabric/auth.middleware';
import {
  approveProposal,
  cancelProposal,
  executeProposal,
  getProposal,
  listPendingProposals,
} from '../../fabric/governance.service';
import { getOrgForDidHash, NoOrgAffiliationError } from '../../fabric/org-membership.service';

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
 * SECURITY (TM-01 fix): the organization that signs this approval is NEVER
 * accepted from the request body. The backend colocates all three
 * organizations' Fabric MSP identities in one process (a documented
 * single-machine demo affordance — see fabric/config.ts), which used to mean
 * a client-supplied `org` field let any single Admin session pick a second
 * organization for itself and satisfy the whole 2-of-3 quorum alone.
 *
 * The organization is now looked up server-side from a fact recorded when
 * this Admin was provisioned (see fabric/org-membership.service.ts) — an
 * Admin can only ever approve as the ONE organization they were actually
 * assigned to represent. A different, real human holding a different
 * organization's Admin credential is now structurally required for the
 * second approval, exactly as the governance model claims.
 *
 * In production each organization would run its own backend holding only its
 * own identity, and no `org` selection would exist at all; this fixes the
 * single-process prototype to behave equivalently until that split happens.
 */
governanceRouter.post('/approve', requireRole('Admin'), async (req: AuthedRequest, res) => {
  const { proposalId } = req.body as { proposalId?: string };
  if (!proposalId) return res.status(400).json({ error: 'proposalId required.' });

  let org;
  try {
    org = await getOrgForDidHash(req.didHash!);
  } catch (err) {
    if (err instanceof NoOrgAffiliationError) {
      return res.status(403).json({ error: err.message });
    }
    return res.status(400).json({ error: (err as Error).message });
  }

  try {
    res.json(await approveProposal(proposalId, org));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

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
