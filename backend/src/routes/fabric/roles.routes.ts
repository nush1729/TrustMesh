import { Router } from 'express';
import { query } from '../../db/client';
import { AuthedRequest, requireRole } from '../../fabric/auth.middleware';
import { getProposalStatus, proposeAction } from '../../fabric/governance.service';
import { ROLE_NAME_TO_HASH, RoleName } from '../../fabric/identity';
import { rolesBySubject, subjectsByRole } from '../../fabric/registry.service';

export const rolesRouter = Router();

/**
 * ============================================================================
 * API CONTRACT CHANGE — /roles
 *   - `account` (an 0x address) becomes `subject` (a DID hash).
 *   - responses return `{ proposalId }` where they returned `{ safeTxHash }`.
 *   - GET /roles/status/:safeTxHash becomes GET /roles/status/:proposalId.
 * Paths, methods and the propose-then-poll pattern are otherwise unchanged.
 *
 * Note that grant/revoke still only PROPOSE. As with the Safe, this route
 * cannot itself change a role — a second organization must approve before
 * anything takes effect. See /governance for the approval endpoints.
 * ============================================================================
 */

rolesRouter.post('/grant', requireRole('Admin'), async (req: AuthedRequest, res) => {
  const { role, subject, expiry, orgLabel } = req.body as {
    role?: RoleName;
    subject?: string;
    expiry?: number;
    orgLabel?: string;
  };
  if (!role || !subject || !expiry || !ROLE_NAME_TO_HASH[role]) {
    return res
      .status(400)
      .json({ error: 'role, subject, expiry are required. role must be Admin/Manager/Auditor/User.' });
  }

  const proposal = await proposeAction('GRANT_ROLE', {
    roleId: ROLE_NAME_TO_HASH[role],
    subject,
    expiry,
  });

  // The human-readable label stays off-chain, correctable and erasable under DPDP.
  await query(
    `INSERT INTO role_labels (did_hash, role_hash, role_name, org_label, expires_at)
     VALUES ($1, $2, $3, $4, to_timestamp($5))`,
    [subject, ROLE_NAME_TO_HASH[role], role, orgLabel ?? null, expiry]
  );

  res.json({ proposalId: proposal.proposalId, status: proposal.status, approvals: proposal.approvals });
});

rolesRouter.post('/revoke', requireRole('Admin'), async (req: AuthedRequest, res) => {
  const { role, subject } = req.body as { role?: RoleName; subject?: string };
  if (!role || !subject || !ROLE_NAME_TO_HASH[role]) {
    return res.status(400).json({ error: 'role and subject are required.' });
  }
  const proposal = await proposeAction('REVOKE_ROLE', { roleId: ROLE_NAME_TO_HASH[role], subject });
  res.json({ proposalId: proposal.proposalId, status: proposal.status, approvals: proposal.approvals });
});

rolesRouter.get('/status/:proposalId', async (req, res) => {
  res.json(await getProposalStatus(req.params.proposalId));
});

/** Every role held by an identity. A CouchDB rich query — not possible on the EVM stack. */
rolesRouter.get('/subject/:didHash', async (req, res) => {
  res.json({ roles: await rolesBySubject(req.params.didHash) });
});

/** Everyone currently holding a role — the admin console's roster. */
rolesRouter.get('/holders/:role', async (req, res) => {
  const role = req.params.role as RoleName;
  if (!ROLE_NAME_TO_HASH[role]) return res.status(400).json({ error: 'Unknown role.' });
  res.json({ holders: await subjectsByRole(role) });
});
