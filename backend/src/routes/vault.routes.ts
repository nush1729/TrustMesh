import { Router } from "express";
import { requireSession, AuthedRequest } from "../middleware/didAuth.middleware";
import { requireRole } from "../middleware/roleGate.middleware";
import { eraseAllForUser } from "../services/vault.service";

export const vaultRouter = Router();

/// DPDP Right to Erasure. Deletes every PII row for the given DID. The
/// chain and any IPFS content that referenced this data are untouched —
/// they just become orphaned, cryptographically meaningless pointers. This
/// is the "anonymization-in-practice" compliance path, not literal
/// on-chain deletion (which is not possible on an immutable ledger).
vaultRouter.post("/erase", requireSession, requireRole("Admin"), async (req: AuthedRequest, res) => {
  const { didHash } = req.body as { didHash?: string };
  if (!didHash) return res.status(400).json({ error: "didHash required." });
  const result = await eraseAllForUser(didHash);
  res.json({ erased: true, erasedRows: result.erasedRows });
});
