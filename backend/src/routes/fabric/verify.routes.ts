import { Router } from 'express';
import { didExists, resolveDidHash } from '../../fabric/did.service';
import { activeRolesFor, assetsByOwner } from '../../fabric/registry.service';

export const verifyRouter = Router();

/**
 * The one route intentionally reachable WITHOUT a session — a verifier is
 * typically a different organization entirely. It answers role and ownership
 * questions straight from ledger state and returns NOTHING from the PII vault,
 * by construction (this route never imports vault.service).
 *
 * ============================================================================
 * API CONTRACT CHANGE — GET /verify/:did
 *   was: required a resolvable 0x address inside the DID (did:ethr:...)
 *   now: accepts a did:key identifier or a raw 64-char DID hash
 *   response: `address` is replaced by `didHash`; `assets` now carries real
 *             asset records rather than reconstructed token ids.
 * ============================================================================
 *
 * The `assets` field is a genuine improvement rather than a port. The EVM
 * version had to REPLAY cached mint/transfer events to guess current ownership,
 * because AssetNFT.sol did not implement ERC721Enumerable — its own comment
 * admitted a production version would need a proper indexed owner map. Here it
 * is a direct, authoritative CouchDB state query.
 */
verifyRouter.get('/:did', async (req, res) => {
  const raw = decodeURIComponent(req.params.did);

  let didHash: string;
  try {
    didHash = resolveDidHash(raw);
  } catch {
    return res.status(400).json({ error: 'did must be a did:key identifier or a 64-character DID hash.' });
  }

  if (!(await didExists(didHash))) {
    return res.status(404).json({ error: 'Unknown DID.' });
  }

  const [roles, assets] = await Promise.all([activeRolesFor(didHash), assetsByOwner(didHash)]);

  res.json({
    did: raw,
    didHash,
    roles,
    assets: assets.map((a) => ({ assetId: a.assetId, ipfsCID: a.ipfsCID, contentHash: a.contentHash })),
    // Per-credential validity is checked by presenting a JWT to
    // vc.service.verifyCredentialJwt, not by this identity-level summary.
    credentialsValid: true,
  });
});
