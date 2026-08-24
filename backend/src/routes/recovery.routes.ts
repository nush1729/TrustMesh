import { Router } from "express";
import { requireSession, AuthedRequest } from "../middleware/didAuth.middleware";
import { addGuardian, proposeRecovery, voteRecovery } from "../services/recovery.service";

export const recoveryRouter = Router();

recoveryRouter.post("/guardians", requireSession, async (req: AuthedRequest, res) => {
  const { didHash, guardianAddress } = req.body as { didHash?: string; guardianAddress?: string };
  if (!didHash || !guardianAddress) return res.status(400).json({ error: "didHash and guardianAddress required." });
  await addGuardian(didHash, guardianAddress);
  res.json({ added: true });
});

recoveryRouter.post("/propose", requireSession, async (req: AuthedRequest, res) => {
  const { didHash, newController } = req.body as { didHash?: string; newController?: string };
  if (!didHash || !newController) return res.status(400).json({ error: "didHash and newController required." });
  const result = await proposeRecovery(didHash, req.walletAddress!, newController);
  res.json(result);
});

recoveryRouter.post("/vote", requireSession, async (req: AuthedRequest, res) => {
  const { requestId } = req.body as { requestId?: string };
  if (!requestId) return res.status(400).json({ error: "requestId required." });
  const result = await voteRecovery(requestId, req.walletAddress!);
  res.json(result);
});
