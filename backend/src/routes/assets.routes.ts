import { Router } from "express";
import multer from "multer";
// P0.4: session auth is now enforced by the app-level deny-by-default gate
// in server.ts — routes no longer individually attach requireSession.
import { AuthedRequest } from "../middleware/didAuth.middleware";
import { requireRole } from "../middleware/roleGate.middleware";
import { assetNFT } from "../services/chain.service";
import { proposeSafeTransaction } from "../services/safe.service";
import { uploadFileToIpfs } from "../services/ipfs.service";
import { config } from "../config";

export const assetsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const assetNFTIface = assetNFT.interface;

assetsRouter.post(
  "/mint",
  requireRole("Admin"),
  upload.single("file"),
  async (req: AuthedRequest, res) => {
    const { to, encrypted } = req.body as { to?: string; encrypted?: string };
    const file = req.file;
    if (!to || !file) return res.status(400).json({ error: "to (address) and file are required." });

    // TM-05 fix: caller must explicitly declare whether this file is
    // pre-encrypted, or explicitly confirm it contains no PII — IPFS content
    // is public and effectively permanent, so silence is no longer treated
    // as "safe to upload as plaintext".
    if (encrypted !== "true" && encrypted !== "false") {
      return res.status(400).json({
        error:
          'encrypted ("true" or "false") is required: state whether this file is pre-encrypted, or explicitly confirm it contains no PII.',
      });
    }
    const { cid, contentHash } = await uploadFileToIpfs(file.buffer, file.originalname, encrypted === "true");

    const data = assetNFTIface.encodeFunctionData("mintAsset", [to, cid, contentHash]);
    const { safeTxHash } = await proposeSafeTransaction(config.contracts.assetNFT, data);

    res.json({ safeTxHash, ipfsCID: cid, contentHash });
  }
);

assetsRouter.post("/transfer", requireRole("Admin"), async (req: AuthedRequest, res) => {
  const { from, to, tokenId } = req.body as { from?: string; to?: string; tokenId?: number };
  if (!from || !to || tokenId === undefined) return res.status(400).json({ error: "from, to, tokenId required." });

  const data = assetNFTIface.encodeFunctionData("transferAsset", [from, to, tokenId]);
  const { safeTxHash } = await proposeSafeTransaction(config.contracts.assetNFT, data);
  res.json({ safeTxHash });
});
