import { Router } from 'express';
import * as crypto from 'crypto';
import { AuthedRequest, requireRole } from '../../fabric/auth.middleware';
import { getUserByDidHash } from '../../fabric/did.service';
import { getCachedAuditFeed } from '../../fabric/indexer.service';
import { proposeAction } from '../../fabric/governance.service';
import { addGuardian, proposeRecovery, voteRecovery } from '../../fabric/recovery.service';
import { getController } from '../../fabric/did.service';
import { issueCredential } from '../../fabric/vc.service';

/**
 * The three small route groups — audit, credentials, recovery — whose Fabric
 * versions are short enough that separate files would be noise.
 */

// --- /audit -----------------------------------------------------------------------

export const auditRouter = Router();

/**
 * PII-free audit feed. Served from the durable, checkpointed indexer
 * (fabric/indexer.service.ts) rather than replayed per request — the Final
 * Solution §8 "is the verification/lookup path fast at scale?" answer.
 *
 * Governed events now additionally carry who proposed and who approved, which
 * the EVM feed could not show: Safe approvals happened in a separate system.
 */
auditRouter.get('/feed', async (_req, res) => {
  res.json({ events: getCachedAuditFeed() });
});

// --- /credentials ------------------------------------------------------------------

export const credentialsRouter = Router();

credentialsRouter.post('/issue', requireRole('Manager'), async (req: AuthedRequest, res) => {
  const { subjectDid, credentialType, claims } = req.body as {
    subjectDid?: string;
    credentialType?: string;
    claims?: Record<string, unknown>;
  };
  if (!subjectDid || !credentialType) {
    return res.status(400).json({ error: 'subjectDid and credentialType required.' });
  }
  const { jwt, issuerDid } = await issueCredential(subjectDid, credentialType, claims ?? {});
  res.json({ credentialJwt: jwt, issuerDid });
});

/**
 * API CONTRACT CHANGE: returns { proposalId } rather than { safeTxHash }.
 * Revocation is a governed action, so this still only proposes.
 */
credentialsRouter.post('/revoke', requireRole('Admin'), async (req: AuthedRequest, res) => {
  const { credentialId } = req.body as { credentialId?: string };
  if (!credentialId) return res.status(400).json({ error: 'credentialId required.' });

  const statusId = crypto.createHash('sha256').update(credentialId, 'utf8').digest('hex');
  const proposal = await proposeAction('SET_CREDENTIAL_STATUS', { statusId, revoked: 'true' });
  res.json({ proposalId: proposal.proposalId, status: proposal.status, statusId });
});

// --- /recovery ----------------------------------------------------------------------

export const recoveryRouter = Router();

/**
 * Stage 1 P0.1 fix, preserved exactly: a guardian may only be added for the
 * CALLER'S OWN DID, derived from their own authenticated session — never a
 * body-supplied didHash. Previously any logged-in user could pass a victim's
 * didHash, register themselves as that victim's guardian, and vote their own
 * fake recovery through: a full identity-hijack path needing no special access.
 *
 * The additional ledger re-check is also preserved: the caller must still be
 * the DID's CURRENT controller, so a DID whose control has already moved on
 * cannot have guardians silently added by whoever holds the session cookie.
 */
recoveryRouter.post('/guardians', async (req: AuthedRequest, res) => {
  const { guardianId } = req.body as { guardianId?: string };
  if (!guardianId) return res.status(400).json({ error: 'guardianId required.' });

  const didHash = req.didHash!;
  const user = await getUserByDidHash(didHash);
  if (!user) return res.status(403).json({ error: 'No registered identity for this session.' });

  let controller: string;
  try {
    controller = await getController(didHash);
  } catch {
    return res.status(403).json({ error: 'DID is not registered on the ledger — cannot add a guardian for it.' });
  }
  // `wallet_address` holds the citizen's public key post-migration.
  if (!controller || controller !== user.wallet_address) {
    return res.status(403).json({ error: 'Only the DID’s current controller may add a guardian for it.' });
  }

  await addGuardian(didHash, guardianId);
  res.json({ added: true, didHash });
});

recoveryRouter.post('/propose', async (req: AuthedRequest, res) => {
  const { didHash, newControllerPublicKey } = req.body as { didHash?: string; newControllerPublicKey?: string };
  if (!didHash || !newControllerPublicKey) {
    return res.status(400).json({ error: 'didHash and newControllerPublicKey required.' });
  }
  try {
    res.json(await proposeRecovery(didHash, req.didHash!, newControllerPublicKey));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

recoveryRouter.post('/vote', async (req: AuthedRequest, res) => {
  const { requestId } = req.body as { requestId?: string };
  if (!requestId) return res.status(400).json({ error: 'requestId required.' });
  try {
    res.json(await voteRecovery(requestId, req.didHash!));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
