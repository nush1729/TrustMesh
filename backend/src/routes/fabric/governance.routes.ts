import { Router } from 'express';
import { OrgKey, ORG_KEYS, fabricConfig } from '../../fabric/config';
import { AuthedRequest, requireRole } from '../../fabric/auth.middleware';
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

function parseOrg(value: unknown): OrgKey {
  const key = String(value ?? '') as OrgKey;
  if (!ORG_KEYS.includes(key)) {
    throw new Error(`org must be one of: ${ORG_KEYS.join(', ')}`);
  }
  return key;
}

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
 * `org` selects which organization's MSP identity signs. In production each
 * organization runs its own backend holding only its own identity and this
 * parameter does not exist; the prototype colocates all three so the full
 * 2-of-3 flow is demonstrable on one machine (see fabric/config.ts).
 */
governanceRouter.post('/approve', requireRole('Admin'), async (req: AuthedRequest, res) => {
  const { proposalId, org } = req.body as { proposalId?: string; org?: string };
  if (!proposalId) return res.status(400).json({ error: 'proposalId required.' });
  try {
    res.json(await approveProposal(proposalId, parseOrg(org)));
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
