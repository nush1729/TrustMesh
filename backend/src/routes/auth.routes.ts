import * as crypto from "crypto";
import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db/client";
import { getUserByDidHash } from "../services/did.service";
import { didToHash, isDidKey, verifySignature } from "../fabric/identity";
import { generateSessionToken, hashSessionToken } from "../utils/session-token";

export const authRouter = Router();

/**
 * ============================================================================
 * BRIDGE NOTE (local demo only, not an upstream design decision)
 * ============================================================================
 * Rewritten from the original EVM version ({address} + ethers.verifyMessage
 * ECDSA-secp256k1 wallet signature) to the did:key + WebCrypto P-256 flow the
 * frontend sends, mirroring routes/fabric/auth.routes.ts. The one real
 * divergence from that Fabric version: it fetches the DID's current
 * controller key from the LEDGER (`getController`); there is no P-256
 * controller field on the EVM DIDRegistry contract to fetch, so this reads
 * the controller key Postgres recorded at registration time instead
 * (`users.wallet_address` — see identity.routes.ts). That is a materially
 * weaker guarantee than the Fabric version (a compromised backend DB, not
 * just a compromised ledger, could substitute a key) and is only acceptable
 * because this is a local, single-machine demo bridge.
 */

const NONCE_TTL_MS = 5 * 60 * 1000;

authRouter.post("/challenge", async (req, res) => {
  const { did } = req.body as { did?: string };
  if (!did || !isDidKey(did)) {
    return res.status(400).json({ error: "A valid did:key identifier is required." });
  }

  const nonce = `TrustMesh login nonce: ${uuidv4()} @ ${new Date().toISOString()}`;
  await query(`INSERT INTO auth_nonces (nonce, wallet_address) VALUES ($1, $2)`, [nonce, didToHash(did)]);
  res.json({ nonce });
});

authRouter.post("/verify", async (req, res) => {
  const { did, signature, nonce, deviceId } = req.body as {
    did?: string;
    signature?: string;
    nonce?: string;
    deviceId?: string;
  };
  if (!did || !signature || !nonce) {
    return res.status(400).json({ error: "did, signature, nonce required." });
  }
  if (!isDidKey(did)) return res.status(400).json({ error: "did must be a did:key identifier." });

  const didHash = didToHash(did);

  const rows = await query<{ nonce: string; wallet_address: string; used: boolean; created_at: string }>(
    `SELECT * FROM auth_nonces WHERE nonce = $1`,
    [nonce]
  );
  const record = rows[0];
  if (!record || record.used || record.wallet_address !== didHash) {
    return res.status(401).json({ error: "Invalid or already-used nonce." });
  }
  if (Date.now() - new Date(record.created_at).getTime() > NONCE_TTL_MS) {
    return res.status(401).json({ error: "Nonce expired — request a new challenge." });
  }

  const user = await getUserByDidHash(didHash);
  if (!user) return res.status(401).json({ error: "DID is not registered — register it before logging in." });
  const controllerPublicKey = user.wallet_address; // base64 SPKI — see identity.routes.ts bridge note

  const message = `TrustMesh DID challenge: ${nonce}`;
  if (!verifySignature(controllerPublicKey, message, signature)) {
    return res.status(401).json({ error: "Signature does not match the DID's registered controller key." });
  }

  await query(`UPDATE auth_nonces SET used = true WHERE nonce = $1`, [nonce]);

  const userAgent = req.headers["user-agent"] || "";
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${userAgent}::${deviceId || ""}`, "utf8")
    .digest("hex");

  const knownRows = await query<{ did_hash: string }>(
    `SELECT did_hash FROM known_devices WHERE did_hash = $1 AND fingerprint = $2`,
    [didHash, fingerprint]
  );
  const newDevice = knownRows.length === 0;

  if (newDevice) {
    await query(
      `INSERT INTO known_devices (did_hash, fingerprint) VALUES ($1, $2)
       ON CONFLICT (did_hash, fingerprint) DO NOTHING`,
      [didHash, fingerprint]
    );
  } else {
    await query(`UPDATE known_devices SET last_seen_at = now() WHERE did_hash = $1 AND fingerprint = $2`, [
      didHash,
      fingerprint,
    ]);
  }

  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await query(`INSERT INTO sessions (token, wallet_address, expires_at) VALUES ($1, $2, $3)`, [
    hashSessionToken(token),
    didHash,
    expiresAt,
  ]);

  res.cookie("trustmesh_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
  });
  res.json({ sessionToken: token, did, didHash, newDevice });
});

authRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.trustmesh_session;
  if (token) {
    await query(`DELETE FROM sessions WHERE token = $1`, [hashSessionToken(token)]);
  }
  res.clearCookie("trustmesh_session");
  res.json({ ok: true });
});
