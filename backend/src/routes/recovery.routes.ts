import { Router } from "express";
// P0.4: session auth is now enforced by the app-level deny-by-default gate
// in server.ts — routes no longer individually attach requireSession.
import { AuthedRequest } from "../middleware/didAuth.middleware";
import { addGuardian, proposeRecovery, voteRecovery } from "../services/recovery.service";
import { buildDid } from "../services/did.service";
import { didRegistry } from "../services/chain.service";

export const recoveryRouter = Router();

// P0.1 fix: a guardian may only be added for the CALLER'S OWN DID, derived
// from their own authenticated session — never a body-supplied `didHash`.
// Previously any logged-in user could pass an arbitrary victim's didHash
// here and register themselves as that victim's "guardian," then vote their
// own fake recovery through — a full identity-hijack path requiring no
// special access. We additionally re-verify on-chain that the caller is
// still the DID's current controller before allowing the addition, so a DID
// whose control has already moved on (or was never registered) can't have
// guardians silently added by whoever currently holds the session cookie.
recoveryRouter.post("/guardians", async (req: AuthedRequest, res) => {
  const { guardianAddress } = req.body as { guardianAddress?: string };
  if (!guardianAddress) return res.status(400).json({ error: "guardianAddress required." });

  const { didHash } = buildDid(req.walletAddress!);

  let controller: string;
  try {
    controller = await didRegistry.getController(didHash);
  } catch {
    return res.status(403).json({ error: "DID is not registered on-chain — cannot add a guardian for it." });
  }
  if (!controller || controller.toLowerCase() !== req.walletAddress!.toLowerCase()) {
    return res.status(403).json({ error: "Only the DID's current controller may add a guardian for it." });
  }

  await addGuardian(didHash, guardianAddress);
  res.json({ added: true, didHash });
});

recoveryRouter.post("/propose", async (req: AuthedRequest, res) => {
  const { didHash, newController } = req.body as { didHash?: string; newController?: string };
  if (!didHash || !newController) return res.status(400).json({ error: "didHash and newController required." });
  const result = await proposeRecovery(didHash, req.walletAddress!, newController);
  res.json(result);
});

recoveryRouter.post("/vote", async (req: AuthedRequest, res) => {
  const { requestId } = req.body as { requestId?: string };
  if (!requestId) return res.status(400).json({ error: "requestId required." });
  const result = await voteRecovery(requestId, req.walletAddress!);
  res.json(result);
});
