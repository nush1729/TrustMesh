import { Router } from "express";
import { getCachedAuditFeed } from "../services/indexer.service";

export const auditRouter = Router();

// P0.4: session auth is now enforced by the app-level deny-by-default gate
// in server.ts — routes no longer individually attach requireSession.
auditRouter.get("/feed", async (_req, res) => {
  res.json({ events: getCachedAuditFeed() });
});
