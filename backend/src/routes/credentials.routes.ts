import { Router } from "express";
import { ethers } from "ethers";
import { requireSession, AuthedRequest } from "../middleware/didAuth.middleware";
import { requireRole } from "../middleware/roleGate.middleware";
import { issueCredential } from "../services/vc.service";
import { revocationRegistry } from "../services/chain.service";
import { proposeSafeTransaction } from "../services/safe.service";
import { config } from "../config";

export const credentialsRouter = Router();
const revocationIface = revocationRegistry.interface;

credentialsRouter.post("/issue", requireSession, requireRole("Manager"), async (req: AuthedRequest, res) => {
  const { subjectDid, credentialType, claims } = req.body as {
    subjectDid?: string;
    credentialType?: string;
    claims?: Record<string, unknown>;
  };
  if (!subjectDid || !credentialType) return res.status(400).json({ error: "subjectDid and credentialType required." });

  const { jwt, issuerDid } = await issueCredential(subjectDid, credentialType, claims ?? {});
  res.json({ credentialJwt: jwt, issuerDid });
});

credentialsRouter.post("/revoke", requireSession, requireRole("Admin"), async (req: AuthedRequest, res) => {
  const { credentialId } = req.body as { credentialId?: string };
  if (!credentialId) return res.status(400).json({ error: "credentialId required." });

  const statusId = ethers.keccak256(ethers.toUtf8Bytes(credentialId));
  const data = revocationIface.encodeFunctionData("setStatus", [statusId, true]);
  const { safeTxHash } = await proposeSafeTransaction(config.contracts.revocationRegistry, data);
  res.json({ safeTxHash });
});
