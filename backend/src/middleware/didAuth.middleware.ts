import { Request, Response, NextFunction } from "express";
import { query } from "../db/client";

export interface AuthedRequest extends Request {
  walletAddress?: string;
}

/// Verifies the session cookie set by POST /auth/verify (which itself only
/// issues a session after a valid signed-DID-challenge — see
/// routes/auth.routes.ts). No passwords anywhere in this system.
export async function requireSession(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.trustmesh_session;
  if (!token) return res.status(401).json({ error: "No session. Complete the signed-DID challenge first." });

  const rows = await query<{ wallet_address: string; expires_at: string }>(
    `SELECT wallet_address, expires_at FROM sessions WHERE token = $1`,
    [token]
  );
  const session = rows[0];
  if (!session || new Date(session.expires_at) < new Date()) {
    return res.status(401).json({ error: "Session expired or invalid." });
  }

  req.walletAddress = session.wallet_address;
  next();
}
