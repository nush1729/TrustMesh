import { Router } from "express";
import { ethers } from "ethers";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db/client";
import { config } from "../config";

export const authRouter = Router();

authRouter.post("/challenge", async (req, res) => {
  const { address } = req.body as { address?: string };
  if (!address || !ethers.isAddress(address)) return res.status(400).json({ error: "Valid address required." });

  const nonce = `TrustMesh login nonce: ${uuidv4()} @ ${new Date().toISOString()}`;
  await query(`INSERT INTO auth_nonces (nonce, wallet_address) VALUES ($1, $2)`, [nonce, address]);
  res.json({ nonce });
});

authRouter.post("/verify", async (req, res) => {
  const { address, signature, nonce } = req.body as { address?: string; signature?: string; nonce?: string };
  if (!address || !signature || !nonce) return res.status(400).json({ error: "address, signature, nonce required." });

  const rows = await query<{ nonce: string; wallet_address: string; used: boolean }>(
    `SELECT * FROM auth_nonces WHERE nonce = $1`,
    [nonce]
  );
  const record = rows[0];
  if (!record || record.used || record.wallet_address.toLowerCase() !== address.toLowerCase()) {
    return res.status(401).json({ error: "Invalid or already-used nonce." });
  }

  const message = `TrustMesh DID challenge: ${nonce}`;
  const recovered = ethers.verifyMessage(message, signature);
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return res.status(401).json({ error: "Signature does not match address." });
  }

  await query(`UPDATE auth_nonces SET used = true WHERE nonce = $1`, [nonce]);

  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await query(`INSERT INTO sessions (token, wallet_address, expires_at) VALUES ($1, $2, $3)`, [
    token,
    address,
    expiresAt,
  ]);

  res.cookie("trustmesh_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
  });
  res.json({ sessionToken: token });
});
