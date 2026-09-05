import { Router } from 'express';
import multer from 'multer';
import { AuthedRequest, requireRole } from '../../fabric/auth.middleware';
import { getProposalStatus, proposeAction } from '../../fabric/governance.service';
import { assetHistory, assetsByOwner, getAsset } from '../../fabric/registry.service';
import { uploadFileToIpfs } from '../../services/ipfs.service';

export const assetsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * ============================================================================
 * API CONTRACT CHANGE — /assets
 *   - `to` / `from` are DID hashes, not 0x addresses.
 *   - `tokenId` becomes `assetId` (a ledger-assigned string id).
 *   - responses return `{ proposalId }` instead of `{ safeTxHash }`.
 * ============================================================================
 *
 * Storage is unchanged: the private, self-hosted Kubo node from Stage 1's P3.1
 * work. Nothing about the IPFS layer depends on which chain sits underneath.
 */

assetsRouter.post('/mint', requireRole('Admin'), upload.single('file'), async (req: AuthedRequest, res) => {
  const { to } = req.body as { to?: string };
  const file = req.file;
  if (!to || !file) return res.status(400).json({ error: 'to (DID hash) and file are required.' });

  // NOTE: if this document contains PII, encrypt it via vault.service BEFORE
  // calling uploadFileToIpfs. Content-addressed storage provides integrity and
  // availability, never confidentiality (Final Solution §8).
  const { cid, contentHash } = await uploadFileToIpfs(file.buffer, file.originalname);

  const proposal = await proposeAction('MINT_ASSET', { owner: to, ipfsCID: cid, contentHash });

  res.json({ proposalId: proposal.proposalId, status: proposal.status, ipfsCID: cid, contentHash });
});

assetsRouter.post('/transfer', requireRole('Admin'), async (req: AuthedRequest, res) => {
  const { from, to, assetId } = req.body as { from?: string; to?: string; assetId?: string };
  if (!from || !to || assetId === undefined) {
    return res.status(400).json({ error: 'from, to, assetId required.' });
  }
  const proposal = await proposeAction('TRANSFER_ASSET', { assetId, from, to });
  res.json({ proposalId: proposal.proposalId, status: proposal.status });
});

assetsRouter.get('/status/:proposalId', async (req, res) => {
  res.json(await getProposalStatus(req.params.proposalId));
});

assetsRouter.get('/owner/:didHash', async (req, res) => {
  res.json({ assets: await assetsByOwner(req.params.didHash) });
});

assetsRouter.get('/:assetId', async (req, res) => {
  try {
    res.json(await getAsset(req.params.assetId));
  } catch {
    res.status(404).json({ error: 'Unknown asset.' });
  }
});

/** Immutable custody provenance, straight from the ledger's key history. */
assetsRouter.get('/:assetId/history', async (req, res) => {
  try {
    res.json({ history: await assetHistory(req.params.assetId) });
  } catch {
    res.status(404).json({ error: 'Unknown asset.' });
  }
});
