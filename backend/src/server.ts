import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import * as crypto from "crypto";
import { config, assertChainConfigured } from "./config";
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
import { requireSession } from "./middleware/didAuth.middleware";

export const app = express();

// P1.1: standard API hardening — security headers, x-powered-by removed.
app.disable("x-powered-by");
app.use(helmet());

app.use(cors({ origin: config.frontendOrigin, credentials: true }));
app.use(cookieParser());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---- P0.4: deny-by-default authentication gate ----
// Previously every route file had to individually remember to attach
// requireSession — a structural risk, since a new route that forgets it is
// silently public. This single app-level gate runs before every route
// handler and requires a valid session UNLESS the path is explicitly
// allowlisted below. `requireRole(...)` calls in individual route files are
// a separate, still-necessary check (on-chain role, not just "has a
// session") and are unaffected.
const CITIZEN_SESSION_ALLOWLIST = new Set(["/health", "/auth/challenge", "/auth/verify"]);
// `/verify/:did` is intentionally public, but by a DELIBERATE, SEPARATE
// design decision — it serves verifier ORGANIZATIONS, not citizen sessions,
// and is not meant to be folded into the 3-entry citizen allowlist above
// (see CHANGE_PROPOSAL.md P0.4/P0.5). It gets its own rate limiter below
// instead of a session check; mTLS-gating it at a gateway layer is tracked
// as later, infrastructure-level work (P1/P3), out of scope here.
const VERIFIER_PUBLIC_PREFIX = "/verify/";

app.use((req, res, next) => {
  if (CITIZEN_SESSION_ALLOWLIST.has(req.path) || req.path.startsWith(VERIFIER_PUBLIC_PREFIX)) {
    return next();
  }
  return requireSession(req, res, next);
});

// ---- P0.5 / P1.1: basic rate limiting on /auth/challenge and /verify/:did ----
// /auth/challenge: unauthenticated nonce issuance is a natural brute-force
// target. /verify/:did: unauthenticated role-enumeration oracle that also
// fans out on-chain calls per request — a free RPC-amplification vector.
const authChallengeLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
const verifyLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

app.use("/auth/challenge", authChallengeLimiter);
app.use("/verify", verifyLimiter);

app.use("/auth", authRouter);
app.use("/identity", identityRouter);
app.use("/credentials", credentialsRouter);
app.use("/roles", rolesRouter);
app.use("/assets", assetsRouter);
app.use("/verify", verifyRouter);
app.use("/recovery", recoveryRouter);
app.use("/vault", vaultRouter);
app.use("/audit", auditRouter);

// P1.3: sanitized error handling — never return err.message (raw Postgres
// constraint errors, upstream API bodies, file paths, etc.) to the caller.
// The real error is logged server-side, tagged with a correlation ID that's
// the only thing the client sees, so it can still be cross-referenced.
export function errorHandler(err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) {
  const correlationId = crypto.randomUUID();
  console.error(`[${correlationId}]`, err);
  res.status(500).json({ error: "Internal error. Contact support with this reference.", correlationId });
}
app.use(errorHandler);

// P1.4: SAFE_LOCAL_MODE bypasses the hosted Safe Transaction Service and
// executes Safe approvals directly with two local owner keys — a
// local-demo-only substitute. Refuse to boot with it enabled against
// anything but the local Hardhat chain (31337). Split out from startServer()
// so it (and assertChainConfigured, in config.ts) can be unit-tested without
// binding a real port.
export function assertSafeLocalModeGuard() {
  if (config.safeLocalMode && config.chainId !== 31337) {
    throw new Error(
      `SAFE_LOCAL_MODE=true is only valid with CHAIN_ID=31337 (local Hardhat). Got CHAIN_ID=${config.chainId}. Refusing to start.`
    );
  }
}

export function startServer() {
  // P1.4: fail fast if contract addresses/keys are unset instead of booting
  // "successfully" into a backend that will error on first real chain call.
  assertChainConfigured();
  assertSafeLocalModeGuard();

  return app.listen(config.port, () => {
    console.log(`TrustMesh backend listening on :${config.port}`);
    startIndexerPolling();
  });
}

if (require.main === module) {
  startServer();
}
