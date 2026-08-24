import { Router } from "express";
import { requireSession } from "../middleware/didAuth.middleware";
import { getCachedAuditFeed } from "../services/indexer.service";

export const auditRouter = Router();

auditRouter.get("/feed", requireSession, async (_req, res) => {
  res.json({ events: getCachedAuditFeed() });
});
