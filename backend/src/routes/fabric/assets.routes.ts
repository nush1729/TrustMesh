import { Router } from 'express';
import multer from 'multer';
import { query } from '../../db/client';
import { AuthedRequest, requireRole, requireSession } from '../../fabric/auth.middleware';
import { decryptAssetBuffer, encryptAssetBuffer } from '../../fabric/asset-encryption.service';
import { ALLOWED_ASSET_FILE_TYPES, detectAllowedFileType } from '../../fabric/file-type.service';
import { getProposalStatus, proposeAction } from '../../fabric/governance.service';
import { assetHistory, assetsByOwner, getAsset, hasActiveRole } from '../../fabric/registry.service';
import { fetchFromIpfs, uploadFileToIpfs } from '../../services/ipfs.service';

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
  const { to, encrypted } = req.body as { to?: string; encrypted?: string };
  const file = req.file;
  if (!to || !file) return res.status(400).json({ error: 'to (DID hash) and file are required.' });
  // TM-05 (kept): the caller must still explicitly declare intent — this is
  // now purely an audit-trail/hygiene signal, not a security boundary, since
  // V2 below makes real encryption unconditional regardless of its value.
  if (encrypted !== 'true' && encrypted !== 'false') {
    return res.status(400).json({
      error:
        "encrypted (\"true\" or \"false\") is required: state whether this file is pre-encrypted, or explicitly confirm it contains no PII.",
    });
  }

  // V3 fix: sniff the actual bytes rather than trusting the client's declared
  // Content-Type/extension. Audit exploit: an SVG carrying an embedded
  // <script>, sent with a mismatched Content-Type, was accepted and anchored
  // with zero validation. Rejects anything outside an explicit allowlist —
  // HTML/SVG/script-executable content included.
  const detected = detectAllowedFileType(file.buffer);
  if (!detected) {
    return res.status(400).json({
      error: 'Unrecognized or disallowed file type.',
      allowed: ALLOWED_ASSET_FILE_TYPES.map((t) => t.ext),
    });
  }

  // V2 fix: the file is ALWAYS encrypted server-side before it ever reaches
  // IPFS — never merely commented as a caller's responsibility, and never
  // conditional on the (client-controlled, honor-system-only) `encrypted`
  // field above. Audit exploit: a PII-marked file minted through this exact
  // endpoint was retrieved in plaintext directly from Kubo, bypassing the
  // backend entirely. contentHash below is computed over the CIPHERTEXT
  // (uploadFileToIpfs hashes whatever buffer it's given) — the same bytes
  // that are actually retrievable — so on-chain integrity verification
  // (GET /assets/:assetId/history and friends) keeps matching what's really
  // stored, rather than a hash of bytes nobody can fetch back unmodified.
  const enc = encryptAssetBuffer(file.buffer);
  const { cid, contentHash } = await uploadFileToIpfs(enc.ciphertext, file.originalname, true);
  await query(
    `INSERT INTO asset_encryption_keys (ipfs_cid, wrapped_dek, iv, auth_tag, uploaded_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [cid, enc.wrappedDek, enc.iv, enc.authTag, req.didHash]
  );

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

/**
 * V2 fix: the only way to get the actual document back in plaintext. Fetches
 * the ciphertext from Kubo by the asset's stored CID and decrypts it
 * server-side with the wrapped key from asset_encryption_keys — nothing
 * plaintext ever touches IPFS itself (see POST /assets/mint above).
 *
 * Gated to the asset's current owner, or an Admin/Auditor — anyone else gets
 * a 403, mirroring the ownership/role-check pattern already used elsewhere
 * (roles.routes.ts's requireRole, auth.middleware's hasActiveRole reads).
 */
assetsRouter.get('/:assetId/document', requireSession, async (req: AuthedRequest, res) => {
  let asset;
  try {
    asset = await getAsset(req.params.assetId);
  } catch {
    return res.status(404).json({ error: 'Unknown asset.' });
  }

  const callerDidHash = req.didHash!;
  const isOwner = asset.owner === callerDidHash;
  const isAdmin = !isOwner && (await hasActiveRole('Admin', callerDidHash));
  const isAuditor = !isOwner && !isAdmin && (await hasActiveRole('Auditor', callerDidHash));
  if (!isOwner && !isAdmin && !isAuditor) {
    return res.status(403).json({ error: 'Only the asset owner, an Admin, or an Auditor may retrieve this document.' });
  }

  const rows = await query<{ wrapped_dek: Buffer; iv: Buffer; auth_tag: Buffer }>(
    `SELECT wrapped_dek, iv, auth_tag FROM asset_encryption_keys WHERE ipfs_cid = $1`,
    [asset.ipfsCID]
  );
  const keyRow = rows[0];
  if (!keyRow) {
    return res.status(404).json({ error: 'No encryption record for this asset (minted before the V2 fix?).' });
  }

  const ciphertext = await fetchFromIpfs(asset.ipfsCID);
  const plaintext = decryptAssetBuffer(ciphertext, keyRow.iv, keyRow.auth_tag, keyRow.wrapped_dek);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="asset-${req.params.assetId}"`);
  res.send(plaintext);
});
