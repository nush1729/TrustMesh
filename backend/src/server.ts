import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "./config";
import { authRouter } from "./routes/auth.routes";
import { identityRouter } from "./routes/identity.routes";
import { credentialsRouter } from "./routes/credentials.routes";
import { rolesRouter } from "./routes/roles.routes";
import { assetsRouter } from "./routes/assets.routes";
import { verifyRouter } from "./routes/verify.routes";
import { recoveryRouter } from "./routes/recovery.routes";
import { vaultRouter } from "./routes/vault.routes";
import { auditRouter } from "./routes/audit.routes";
import { startIndexerPolling } from "./services/indexer.service";

const app = express();

app.use(cors({ origin: config.frontendOrigin, credentials: true }));
app.use(cookieParser());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/identity", identityRouter);
app.use("/credentials", credentialsRouter);
app.use("/roles", rolesRouter);
app.use("/assets", assetsRouter);
app.use("/verify", verifyRouter);
app.use("/recovery", recoveryRouter);
app.use("/vault", vaultRouter);
app.use("/audit", auditRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

app.listen(config.port, () => {
  console.log(`TrustMesh backend listening on :${config.port}`);
  startIndexerPolling();
});
