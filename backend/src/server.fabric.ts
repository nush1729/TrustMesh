// MUST be imported before the routers are defined. Express 4 does not catch
// rejections from async route handlers: an awaited call that throws becomes an
// unhandled rejection, which under Node 15+ terminates the process. Every
// async route in this backend was therefore a remote crash away from taking
// the whole API down — found while exercising the UI, when a bad vault key
// killed the server instead of returning a 500. This patch routes async
// throws into the error handler below, where they belong.
import 'express-async-errors';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import * as crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config';
import { assertFabricConfigured, fabricConfig } from './fabric/config';
import { requireSession } from './fabric/auth.middleware';
import { closeGateways, pingChaincode } from './fabric/gateway';
import { startIndexer } from './fabric/indexer.service';
import { authRouter } from './routes/fabric/auth.routes';
import { assetsRouter } from './routes/fabric/assets.routes';
import { governanceRouter } from './routes/fabric/governance.routes';
import { identityRouter } from './routes/fabric/identity.routes';
import { auditRouter, credentialsRouter, recoveryRouter } from './routes/fabric/misc.routes';
import { rolesRouter } from './routes/fabric/roles.routes';
import { verifyRouter } from './routes/fabric/verify.routes';
import { vaultRouter } from './routes/fabric/vault.routes';

/**
 * TrustMesh backend, Hyperledger Fabric edition.
 *
 * Deliberately a SEPARATE entrypoint from src/server.ts rather than a rewrite
 * of it. The implementation prompt's ground rules require the EVM stack stay
 * runnable as the fallback path throughout the migration, and rewriting the
 * shared route files in place would have broken the Stage 1 P0 regression tests
 * that guard the live security fixes. Both stacks therefore build and test
 * side by side until Phase 6 cutover, at which point this becomes server.ts.
 *
 * Every Stage 1 hardening measure is carried over deliberately, not by
 * accident of copying: deny-by-default auth (P0.4), helmet and rate limiting
 * (P1.1/P0.5), hashed session tokens with nonce expiry (P1.2), a sanitized
 * error handler (P1.3), and fail-fast boot configuration checks (P1.4).
 */

export const app = express();

// Stage 1 P1.1: security headers, x-powered-by removed.
app.disable('x-powered-by');
app.use(helmet());

app.use(cors({ origin: config.frontendOrigin, credentials: true }));
app.use(cookieParser());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, chain: 'hyperledger-fabric' }));

/** Deeper health check — actually reaches the peer, channel and chaincode. */
app.get('/health/chain', async (_req, res) => {
  try {
    res.json(await pingChaincode());
  } catch (err) {
    res.status(503).json({ ok: false, error: (err as Error).message });
  }
});

// ---- Stage 1 P0.4: deny-by-default authentication gate ----
// A route is protected unless explicitly allowlisted here. Preserved exactly,
// because the structural risk it fixes — a new route silently shipping public
// because someone forgot to attach requireSession — is unchanged by the chain
// migration.
//
// One entry is NEW relative to the EVM allowlist: POST /identity/did.
// Registration must be reachable without a session, because a session is only
// issued after a signed challenge against the public key the LEDGER holds for
// a DID — which cannot exist before registration. The EVM stack did not need
// this entry only because the browser wallet submitted that transaction
// itself. Self-registration is still not unauthenticated in any meaningful
// sense: the chaincode requires a proof-of-possession signature over the DID.
const PUBLIC_PATHS = new Set([
  '/health',
  '/health/chain',
  '/auth/challenge',
  '/auth/verify',
  '/identity/did',
]);

// `/verify/:did` is public by a deliberate, separate design decision — it
// serves verifier ORGANIZATIONS, not citizen sessions. It gets its own rate
// limiter rather than a session check; mTLS-gating it at the gateway layer
// remains infrastructure-level work.
const VERIFIER_PUBLIC_PREFIX = '/verify/';

app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path) || req.path.startsWith(VERIFIER_PUBLIC_PREFIX)) {
    return next();
  }
  return requireSession(req, res, next);
});

// ---- Stage 1 P0.5 / P1.1: rate limiting ----
// /auth/challenge: unauthenticated nonce issuance is a brute-force target.
// /verify: an unauthenticated role-enumeration oracle that fans out ledger
// reads per request.
// /identity/did: newly public, and it submits a real ledger transaction per
// call, so it needs a tighter limit than either — without one it is a free
// write-amplification vector against the ordering service.
//
// The test suite legitimately registers dozens of identities in seconds, which
// these limits are designed to stop. Rather than raise the real limits to
// accommodate tests -- which would weaken the running system to make a test
// pass -- the limiter is skipped only under NODE_ENV=test. The double
// condition is deliberate: RATE_LIMIT_DISABLED alone can never disable rate
// limiting in a deployed environment, because NODE_ENV is not 'test' there.
const rateLimitsDisabled = process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_DISABLED === 'true';

function limiter(max: number) {
  return rateLimit({
    windowMs: 60_000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => rateLimitsDisabled,
  });
}

app.use('/auth/challenge', limiter(20));
app.use('/verify', limiter(30));
app.use('/identity/did', limiter(10));

app.use('/auth', authRouter);
app.use('/identity', identityRouter);
app.use('/credentials', credentialsRouter);
app.use('/roles', rolesRouter);
app.use('/assets', assetsRouter);
app.use('/governance', governanceRouter);
app.use('/verify', verifyRouter);
app.use('/recovery', recoveryRouter);
// Untouched by this migration, as required: the vault and its DPDP
// erasure-by-key-destruction logic are architecture-agnostic.
app.use('/vault', vaultRouter);
app.use('/audit', auditRouter);

// Stage 1 P1.3: sanitized errors — the real error is logged server-side with a
// correlation id, and only that id reaches the client.
export function errorHandler(
  err: Error,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction
) {
  const correlationId = crypto.randomUUID();
  console.error(`[${correlationId}]`, err);
  res.status(500).json({ error: 'Internal error. Contact support with this reference.', correlationId });
}
app.use(errorHandler);

/**
 * Stage 1 P1.4 equivalent: fail fast on misconfiguration instead of booting
 * "successfully" into a backend that errors on its first ledger call. Checks
 * the MSP material actually exists rather than only that env vars are set.
 */
export function assertConfigured() {
  assertFabricConfigured();
  if (!fabricConfig.vcIssuerPrivateKey) {
    throw new Error('VC_ISSUER_PRIVATE_KEY is not set — credential issuance would fail at runtime.');
  }
}

export async function startServer() {
  assertConfigured();
  await pingChaincode();

  // Last-resort net for rejections that originate outside a request — the
  // event indexer's background stream, for instance. Without this, Node's
  // default is to terminate, so a transient peer disconnect could take the API
  // down even though the indexer already knows how to reconnect from its
  // checkpoint. Logged loudly rather than swallowed silently.
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });

  const server = app.listen(config.port, () => {
    console.log(`TrustMesh backend (Fabric) listening on :${config.port}`);
    console.log(`  channel=${fabricConfig.channelName} chaincode=${fabricConfig.chaincodeName}`);
    startIndexer();
  });

  const shutdown = async () => {
    server.close();
    await closeGateways();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
}
