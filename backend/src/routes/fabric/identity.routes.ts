import { Router } from 'express';
import { AuthedRequest } from '../../fabric/auth.middleware';
import { getUserByDidHash, registerUser } from '../../fabric/did.service';
import { issueCredential } from '../../fabric/vc.service';
import { fetchMockDocument, MOCK_DOCUMENT_TYPES } from '../../services/digilocker.mock';
import { storeField } from '../../services/vault.service';

export const identityRouter = Router();

/**
 * DID registration.
 *
 * ============================================================================
 * API CONTRACT CHANGE — POST /identity/did
 *   was: session-gated, no body; DID derived from req.walletAddress, because
 *        the frontend had already called DIDRegistry.registerDID() itself from
 *        the user's own wallet and this route only recorded the off-chain side.
 *   now: UNAUTHENTICATED (allowlisted in server.fabric.ts), body
 *        { publicKey, signature }; this route submits the ledger registration.
 *
 * Why it must be unauthenticated: a session is only issued after a
 * signed-challenge against the public key the LEDGER holds for a DID, so a
 * citizen cannot possibly have a session before their DID exists. Registration
 * is necessarily the pre-session step. This is not a weakening — it mirrors the
 * EVM design exactly, where anyone could call registerDID() from their own
 * wallet without an admin's permission, which the Final Solution (§3 Step 1)
 * calls out as the deliberate self-sovereign property.
 *
 * What stands in for `msg.sender`: `signature` is a proof of possession over
 * the DID string, verified BY THE CHAINCODE. Without it, this endpoint would
 * let anyone register a DID against a key they do not hold.
 * ============================================================================
 */
identityRouter.post('/did', async (req, res) => {
  const { publicKey, signature } = req.body as { publicKey?: string; signature?: string };
  if (!publicKey || !signature) {
    return res.status(400).json({ error: 'publicKey (base64 SPKI) and signature (base64) are required.' });
  }
  try {
    res.json(await registerUser(publicKey, signature));
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
});

/** The authenticated citizen's own identity — replaces reading req.walletAddress client-side. */
identityRouter.get('/me', async (req: AuthedRequest, res) => {
  const user = await getUserByDidHash(req.didHash!);
  res.json({ didHash: req.didHash, did: user?.did ?? null });
});

identityRouter.post('/digilocker-import', async (req: AuthedRequest, res) => {
  const { documentType } = req.body as { documentType?: string };
  if (!documentType || !MOCK_DOCUMENT_TYPES.includes(documentType as any)) {
    return res.status(400).json({ error: `documentType must be one of: ${MOCK_DOCUMENT_TYPES.join(', ')}` });
  }

  // Stage 1 P0.2 fix, preserved exactly: didHash comes ALWAYS from the caller's
  // own authenticated session, never from the request body. A body-supplied
  // didHash previously let any logged-in user poison another citizen's vault
  // record. A body-supplied value is ignored, not merged.
  const didHash = req.didHash!;
  const user = await getUserByDidHash(didHash);
  if (!user) return res.status(404).json({ error: 'No registered identity for this session.' });

  const fields = fetchMockDocument(documentType);

  // Every field value is PII and goes ONLY into the encrypted vault — never
  // into credential claims and never onto the ledger.
  await Promise.all(Object.entries(fields).map(([k, v]) => storeField(didHash, k, v)));

  // The credential attests that a document of this type was verified and
  // vaulted — not the field values themselves.
  const { jwt, issuerDid } = await issueCredential(user.did, 'DigiLockerImportCredential', {
    documentType,
    verifiedFieldCount: Object.keys(fields).length,
  });

  res.json({ credentialJwt: jwt, issuerDid });
});
