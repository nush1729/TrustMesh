import { Router } from "express";
import { ethers } from "ethers";
import { accessControlRegistry, ROLE_NAME_TO_HASH } from "../services/chain.service";
import { isDidKey } from "../fabric/identity";
import { getUserByDidHash } from "../services/did.service";

export const verifyRouter = Router();

/// The one route intentionally reachable WITHOUT a session — a verifier is
/// typically a different organization entirely. It answers role/ownership/
/// credential-status questions straight from on-chain state and returns
/// NOTHING from the PII vault, by construction (this route never imports
/// vault.service).
verifyRouter.get("/:did", async (req, res) => {
  const did = decodeURIComponent(req.params.did);

  // BRIDGE NOTE: did:key identities (see routes/identity.routes.ts) have no
  // EVM address and are anchored off-chain only in this bridge — there is no
  // on-chain role/ownership state to check for one. Answer from the
  // off-chain `users` table instead of 400ing, so the frontend's
  // "is this DID registered?" check (identity-context.tsx's refresh()) works
  // for the identity model this backend actually issues. Roles/assets are
  // honestly reported empty rather than guessed at.
  if (isDidKey(did)) {
    const { didToHash } = await import("../fabric/identity");
    const user = await getUserByDidHash(didToHash(did));
    if (!user) return res.status(404).json({ error: "DID not registered." });
    return res.json({ did, address: null, roles: [], assets: [], credentialsValid: true });
  }

  const addressMatch = did.match(/0x[a-fA-F0-9]{40}/);
  if (!addressMatch) return res.status(400).json({ error: "did must contain a resolvable 0x address (did:ethr:...)." });
  const address = ethers.getAddress(addressMatch[0]);

  const roleChecks = await Promise.all(
    Object.entries(ROLE_NAME_TO_HASH).map(async ([name, hash]) => ({
      name: name.replace("_ROLE", ""),
      active: await accessControlRegistry.hasActiveRole(hash, address),
    }))
  );
  const roles = roleChecks.filter((r) => r.active).map((r) => r.name);

  // Prototype scope: token ids owned by `address` are read from the audit
  // indexer's cached AssetMinted/AssetTransferred events rather than a
  // dedicated on-chain enumeration call, since AssetNFT does not implement
  // ERC721Enumerable (kept minimal on purpose). A production version would
  // back this with a proper indexed owner map.
  const { getCachedAuditFeed } = await import("../services/indexer.service");
  const owned = new Map<string, boolean>();
  for (const e of getCachedAuditFeed()) {
    if (e.type === "ASSET_MINTED" && e.actor.toLowerCase() === address.toLowerCase()) {
      owned.set(e.target, true);
    }
    if (e.type === "ASSET_TRANSFERRED") {
      if (e.target.toLowerCase() === address.toLowerCase()) owned.set(e.id, true);
      if (e.actor.toLowerCase() === address.toLowerCase()) owned.delete(e.id);
    }
  }

  res.json({
    did,
    address,
    roles,
    assets: Array.from(owned.keys()),
    credentialsValid: true, // credential-level check happens per-VC via vc.service.verifyCredentialJwt when a JWT is presented
  });
});
