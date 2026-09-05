import { Router } from "express";
// P0.4: session auth is now enforced by the app-level deny-by-default gate
// in server.ts — routes no longer individually attach requireSession.
import { AuthedRequest } from "../middleware/didAuth.middleware";
import { requireRole } from "../middleware/roleGate.middleware";
import { accessControlRegistry, ROLE_NAME_TO_HASH } from "../services/chain.service";
import { proposeSafeTransaction } from "../services/safe.service";
import { config } from "../config";
import { query } from "../db/client";

export const rolesRouter = Router();

const accessControlIface = accessControlRegistry.interface;

rolesRouter.post("/grant", requireRole("Admin"), async (req: AuthedRequest, res) => {
  const { role, account, expiry, didHash, orgLabel } = req.body as {
    role?: keyof typeof ROLE_NAME_TO_HASH;
    account?: string;
    expiry?: number;
    didHash?: string;
    orgLabel?: string;
  };
  if (!role || !account || !expiry || !ROLE_NAME_TO_HASH[role]) {
    return res.status(400).json({ error: "role, account, expiry are required. role must be Admin/Manager/Auditor/User." });
  }

  const data = accessControlIface.encodeFunctionData("grantRoleWithExpiry", [ROLE_NAME_TO_HASH[role], account, expiry]);
  const { safeTxHash } = await proposeSafeTransaction(config.contracts.accessControlRegistry, data);

  // The human-readable label lives off-chain, correctable/erasable under DPDP.
  if (didHash) {
    await query(
      `INSERT INTO role_labels (did_hash, role_hash, role_name, org_label, expires_at)
       VALUES ($1, $2, $3, $4, to_timestamp($5))`,
      [didHash, ROLE_NAME_TO_HASH[role], role, orgLabel ?? null, expiry]
    );
  }

  res.json({ safeTxHash });
});

rolesRouter.post("/revoke", requireRole("Admin"), async (req: AuthedRequest, res) => {
  const { role, account } = req.body as { role?: keyof typeof ROLE_NAME_TO_HASH; account?: string };
  if (!role || !account || !ROLE_NAME_TO_HASH[role]) {
    return res.status(400).json({ error: "role and account are required." });
  }

  const data = accessControlIface.encodeFunctionData("revokeRoleEarly", [ROLE_NAME_TO_HASH[role], account]);
  const { safeTxHash } = await proposeSafeTransaction(config.contracts.accessControlRegistry, data);
  res.json({ safeTxHash });
});

rolesRouter.get("/status/:safeTxHash", async (req, res) => {
  const { getSafeTransactionStatus } = await import("../services/safe.service");
  const status = await getSafeTransactionStatus(req.params.safeTxHash);
  res.json(status);
});
