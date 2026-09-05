import { Router } from "express";
// P0.4: session auth is now enforced by the app-level deny-by-default gate
// in server.ts — routes no longer individually attach requireSession.
import { AuthedRequest } from "../middleware/didAuth.middleware";
import { registerUser, buildDid } from "../services/did.service";
import { issueCredential } from "../services/vc.service";
import { fetchMockDocument, MOCK_DOCUMENT_TYPES } from "../services/digilocker.mock";
import { storeField } from "../services/vault.service";

export const identityRouter = Router();

identityRouter.post("/did", async (req: AuthedRequest, res) => {
  const result = await registerUser(req.walletAddress!);
  res.json(result);
});

identityRouter.post("/digilocker-import", async (req: AuthedRequest, res) => {
  const { documentType } = req.body as { documentType?: string };
  if (!documentType || !MOCK_DOCUMENT_TYPES.includes(documentType as any)) {
    return res.status(400).json({ error: `documentType must be one of: ${MOCK_DOCUMENT_TYPES.join(", ")}` });
  }

  // P0.2 fix: didHash is ALWAYS derived from the caller's own authenticated
  // session, never taken from the request body. Previously a body-supplied
  // didHash was written straight into the PII vault, letting any logged-in
  // user poison another citizen's record with attacker-controlled data. A
  // body-supplied didHash (if present) is silently ignored, not merged.
  const { did, didHash } = buildDid(req.walletAddress!);
  const fields = fetchMockDocument(documentType);

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
