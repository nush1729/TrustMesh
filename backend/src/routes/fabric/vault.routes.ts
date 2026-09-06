import { Router } from 'express';
import { AuthedRequest, requireRole } from '../../fabric/auth.middleware';
import { requestOrApproveErasure } from '../../services/erasure.service';

export const vaultRouter = Router();

/**
 * DPDP Right to Erasure — Fabric-stack route wrapper.
 *
 * The vault itself is EXPLICITLY OUT OF SCOPE for this migration
 * (docs/IMPLEMENTATION_PROMPT.md: "Do NOT touch backend/src/services/
 * vault.service.ts, the Postgres schema, or any DPDP-erasure-by-key-destruction
 * logic"), and neither vault.service.ts nor erasure.service.ts is modified —
 * both are chain-agnostic, talking only to Postgres.
 *
 * This file exists solely because the ORIGINAL vault.routes.ts imports the EVM
 * middleware (roleGate.middleware.ts -> chain.service.ts -> ethers + Hardhat
 * artifacts), which would drag the entire EVM stack into the Fabric server.
 * The only difference from the original is which middleware enforces the Admin
 * role, and that the actor is a DID hash rather than a wallet address. The
 * erasure semantics — Stage 1's P0.3 two-approval flow, the audit log, and
 * erasure-by-key-destruction — are reached through the same unmodified service.
 */
vaultRouter.post('/erase', requireRole('Admin'), async (req: AuthedRequest, res) => {
  const { didHash, reason } = req.body as { didHash?: string; reason?: string };
  if (!didHash) return res.status(400).json({ error: 'didHash required.' });

  // Stage 1 P0.3: the first Admin call only creates a pending request; a
  // SECOND, DISTINCT Admin must call it for the same didHash before any key
  // material is destroyed.
  const result = await requestOrApproveErasure(didHash, req.didHash!, reason);
  res.json({ erased: result.status === 'executed', ...result });
});
