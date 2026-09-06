import { Router } from 'express';
import { computeTransparencyStats, TransparencyStats } from '../../fabric/transparency.service';

/**
 * Item 4 (public transparency dashboard). PUBLIC, no session — see
 * PUBLIC_PATHS in server.fabric.ts. Backed by live ledger/indexer reads
 * (transparency.service.ts), cached briefly so a burst of dashboard loads
 * doesn't fan out a full set of CouchDB rich queries + ledger reads per
 * request; real ledger state is never more than a few seconds stale.
 */
export const transparencyRouter = Router();

const CACHE_TTL_MS = 5_000;
let cache: { stats: TransparencyStats; expiresAt: number } | null = null;

transparencyRouter.get('/stats', async (_req, res) => {
  if (!cache || Date.now() > cache.expiresAt) {
    const stats = await computeTransparencyStats();
    cache = { stats, expiresAt: Date.now() + CACHE_TTL_MS };
  }
  res.json(cache.stats);
});
