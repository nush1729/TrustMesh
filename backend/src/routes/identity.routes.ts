import { Router } from "express";
import { requireSession, AuthedRequest } from "../middleware/didAuth.middleware";
import { registerUser, buildDid } from "../services/did.service";
import { issueCredential } from "../services/vc.service";
import { fetchMockDocument, MOCK_DOCUMENT_TYPES } from "../services/digilocker.mock";
import { storeField } from "../services/vault.service";

export const identityRouter = Router();

identityRouter.post("/did", requireSession, async (req: AuthedRequest, res) => {
  const result = await registerUser(req.walletAddress!);
  res.json(result);
});

identityRouter.post("/digilocker-import", requireSession, async (req: AuthedRequest, res) => {
  const { didHash, documentType } = req.body as { didHash?: string; documentType?: string };
  if (!didHash || !documentType || !MOCK_DOCUMENT_TYPES.includes(documentType as any)) {
    return res.status(400).json({ error: `documentType must be one of: ${MOCK_DOCUMENT_TYPES.join(", ")}` });
  }

  const fields = fetchMockDocument(documentType);
  const { did } = buildDid(req.walletAddress!);

  // Every field value is PII and goes ONLY into the encrypted vault — never
  // into the credential claims themselves or on-chain.
  await Promise.all(Object.entries(fields).map(([k, v]) => storeField(didHash, k, v)));

  // The credential attests that a document of this type was verified and
  // vaulted — not the field values themselves.
  const { jwt, issuerDid } = await issueCredential(did, "DigiLockerImportCredential", {
    documentType,
    verifiedFieldCount: Object.keys(fields).length,
  });

  res.json({ credentialJwt: jwt, issuerDid });
});
