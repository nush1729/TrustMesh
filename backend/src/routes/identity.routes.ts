import { Router } from "express";
// P0.4: session auth is now enforced by the app-level deny-by-default gate
// in server.ts — routes no longer individually attach requireSession.
import { AuthedRequest } from "../middleware/didAuth.middleware";
// Reused as-is from the Fabric stack: pure Node `crypto`, no Fabric gateway
// dependency, so it works unchanged against the EVM backend too. See the
// file header there for why WebCrypto's raw r||s ECDSA output needs
// `dsaEncoding: 'ieee-p1363'` to verify correctly against Node's default DER
// expectation.
import { didKeyFromPublicKey, didToHash, isValidPublicKey, verifySignature } from "../fabric/identity";
import { getUserByDidHash } from "../services/did.service";
import { issueCredential } from "../services/vc.service";
import { fetchMockDocument, MOCK_DOCUMENT_TYPES } from "../services/digilocker.mock";
import { storeField } from "../services/vault.service";
import { query } from "../db/client";

export const identityRouter = Router();

/**
 * ============================================================================
 * BRIDGE NOTE (local demo only, not an upstream design decision)
 * ============================================================================
 * This route was rewritten from the original EVM contract (session-gated,
 * DID derived from req.walletAddress, on-chain registerDID() called by the
 * citizen's own wallet) to accept the did:key + WebCrypto proof-of-possession
 * flow the frontend actually sends, matching routes/fabric/identity.routes.ts.
 *
 * It deliberately does NOT call DIDRegistry.registerDID() on-chain: that
 * contract's controller field is an `address`, set to `msg.sender`, and there
 * is no citizen wallet here to be msg.sender — only a P-256 WebCrypto key,
 * which the EVM contract has no field to hold. Recording the anchor
 * on-chain for this identity model would need a contract change (a new
 * relayer-only "register on behalf of" function), which is out of scope for
 * this bridge. The DID is anchored off-chain (Postgres `users`) only;
 * `onChainConfirmed` is honestly reported as false rather than faked.
 */
identityRouter.post("/did", async (req, res) => {
  const { publicKey, signature } = req.body as { publicKey?: string; signature?: string };
  if (!publicKey || !signature) {
    return res.status(400).json({ error: "publicKey (base64 SPKI) and signature (base64) are required." });
  }
  if (!isValidPublicKey(publicKey)) {
    return res.status(400).json({ error: "publicKey must be a base64 SPKI DER ECDSA P-256 public key" });
  }

  const did = didKeyFromPublicKey(publicKey);
  const didHash = didToHash(did);

  if (!verifySignature(publicKey, did, signature)) {
    return res.status(400).json({ error: "signature does not prove possession of the private key for this public key" });
  }

  await query(
    `INSERT INTO users (did_hash, did, wallet_address)
     VALUES ($1, $2, $3)
     ON CONFLICT (did_hash) DO NOTHING`,
    [didHash, did, publicKey]
  );

  res.json({ did, didHash, onChainConfirmed: false });
});

/** The authenticated citizen's own identity — mirrors routes/fabric/identity.routes.ts. */
identityRouter.get("/me", async (req: AuthedRequest, res) => {
  const user = await getUserByDidHash(req.walletAddress!);
  res.json({ didHash: req.walletAddress, did: user?.did ?? null });
});

identityRouter.post("/digilocker-import", async (req: AuthedRequest, res) => {
  const { documentType } = req.body as { documentType?: string };
  if (!documentType || !MOCK_DOCUMENT_TYPES.includes(documentType as any)) {
    return res.status(400).json({ error: `documentType must be one of: ${MOCK_DOCUMENT_TYPES.join(", ")}` });
  }

  // P0.2 fix: didHash is ALWAYS derived from the caller's own authenticated
  // session, never taken from the request body.
  const didHash = req.walletAddress!;
  const user = await getUserByDidHash(didHash);
  if (!user) return res.status(404).json({ error: "No registered identity for this session." });

  const fields = fetchMockDocument(documentType);

  // Every field value is PII and goes ONLY into the encrypted vault — never
  // into the credential claims themselves or on-chain.
  await Promise.all(Object.entries(fields).map(([k, v]) => storeField(didHash, k, v)));

  // The credential attests that a document of this type was verified and
  // vaulted — not the field values themselves.
  const { jwt, issuerDid } = await issueCredential(user.did, "DigiLockerImportCredential", {
    documentType,
    verifiedFieldCount: Object.keys(fields).length,
  });

  res.json({ credentialJwt: jwt, issuerDid });
});
