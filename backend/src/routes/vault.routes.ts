import { Router } from "express";
// P0.4: session auth is now enforced by the app-level deny-by-default gate
// in server.ts — routes no longer individually attach requireSession.
import { AuthedRequest } from "../middleware/didAuth.middleware";
import { requireRole } from "../middleware/roleGate.middleware";
import { requestOrApproveErasure } from "../services/erasure.service";

export const vaultRouter = Router();

/// DPDP Right to Erasure. Deletes every PII row for the given DID. The
/// chain and any IPFS content that referenced this data are untouched —
/// they just become orphaned, cryptographically meaningless pointers. This
/// is the "anonymization-in-practice" compliance path, not literal
/// on-chain deletion (which is not possible on an immutable ledger).
///
/// P0.3 fix: this no longer executes immediately on a single Admin session.
/// It is now a 2-approval request (see services/erasure.service.ts) — the
/// first Admin call creates a pending request, and only a SECOND, DISTINCT
/// Admin session calling it for the same didHash causes the actual erasure
/// to execute. Every request/approval/execution step is written to
/// erasure_audit_log before any key material is destroyed.
vaultRouter.post("/erase", requireRole("Admin"), async (req: AuthedRequest, res) => {
  const { didHash, reason } = req.body as { didHash?: string; reason?: string };
  if (!didHash) return res.status(400).json({ error: "didHash required." });
  const result = await requestOrApproveErasure(didHash, req.walletAddress!, reason);
  res.json({ erased: result.status === "executed", ...result });
});
