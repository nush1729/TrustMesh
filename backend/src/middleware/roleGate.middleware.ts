import { Response, NextFunction } from "express";
import { AuthedRequest } from "./didAuth.middleware";
import { accessControlRegistry, ROLE_NAME_TO_HASH } from "../services/chain.service";

/// Gates a route on an ON-CHAIN role check (never a database flag) — the
/// same source of truth the smart contracts themselves enforce, so the API
/// can't be tricked into allowing something the chain would reject anyway.
export function requireRole(roleName: keyof typeof ROLE_NAME_TO_HASH) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.walletAddress) return res.status(401).json({ error: "Not authenticated." });

    const roleHash = ROLE_NAME_TO_HASH[roleName];
    const active = await accessControlRegistry.hasActiveRole(roleHash, req.walletAddress);
    if (!active) {
      return res.status(403).json({ error: `Requires an active on-chain ${roleName} role.` });
    }
    next();
  };
}
