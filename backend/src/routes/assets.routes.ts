import { Router } from "express";
import multer from "multer";
import { requireSession, AuthedRequest } from "../middleware/didAuth.middleware";
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
  requireSession,
  requireRole("Admin"),
  upload.single("file"),
  async (req: AuthedRequest, res) => {
    const { to } = req.body as { to?: string };
    const file = req.file;
    if (!to || !file) return res.status(400).json({ error: "to (address) and file are required." });

    // NOTE: if this document contains PII, encrypt it via vault.service
    // BEFORE calling uploadFileToIpfs — IPFS content is public and
    // effectively permanent. Non-PII asset documents (equipment specs,
    // certificate templates) can go straight to IPFS as here.
    const { cid, contentHash } = await uploadFileToIpfs(file.buffer, file.originalname);

    const data = assetNFTIface.encodeFunctionData("mintAsset", [to, cid, contentHash]);
    const { safeTxHash } = await proposeSafeTransaction(config.contracts.assetNFT, data);

    res.json({ safeTxHash, ipfsCID: cid, contentHash });
  }
);

assetsRouter.post("/transfer", requireSession, requireRole("Admin"), async (req: AuthedRequest, res) => {
  const { from, to, tokenId } = req.body as { from?: string; to?: string; tokenId?: number };
  if (!from || !to || tokenId === undefined) return res.status(400).json({ error: "from, to, tokenId required." });

  const data = assetNFTIface.encodeFunctionData("transferAsset", [from, to, tokenId]);
  const { safeTxHash } = await proposeSafeTransaction(config.contracts.assetNFT, data);
  res.json({ safeTxHash });
});
