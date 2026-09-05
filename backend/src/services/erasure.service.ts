import { v4 as uuidv4 } from "uuid";
import { query } from "../db/client";
import { eraseAllForUser } from "./vault.service";

/// P0.3 fix: governed DPDP erasure. `/vault/erase` used to destroy a
/// citizen's PII immediately on a single Admin session — no second
/// approval, no audit trail. This service turns that into a 2-of-2 (by
/// default) off-chain approval flow, mirroring the propose/vote pattern
/// already used for guardian recovery (recovery.service.ts) and Safe
/// transactions (safe.service.ts) elsewhere in the system. The actual key
/// destruction (`eraseAllForUser`, in the untouched vault.service.ts) is
/// only ever called once the threshold is met — never on the first request.
const DEFAULT_THRESHOLD = 2;

interface ErasureRequestRow {
  id: string;
  did_hash: string;
  approvals: string[];
  threshold: number;
  status: string;
}

async function logAudit(erasureRequestId: string, actor: string, action: string, reason?: string | null) {
  await query(
    `INSERT INTO erasure_audit_log (erasure_request_id, actor, action, reason) VALUES ($1, $2, $3, $4)`,
    [erasureRequestId, actor, action, reason ?? null]
  );
}

async function findPendingRequest(didHash: string): Promise<ErasureRequestRow | null> {
  const rows = await query<ErasureRequestRow>(
    `SELECT id, did_hash, approvals, threshold, status FROM erasure_requests
     WHERE did_hash = $1 AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
    [didHash]
  );
  return rows[0] ?? null;
}

/// A single Admin session calling this creates (or joins) a pending erasure
/// request. Only once a SECOND, DISTINCT admin session calls it for the
/// same didHash does the request cross threshold and actually execute.
export async function requestOrApproveErasure(
  didHash: string,
  actor: string,
  reason?: string
): Promise<{ id: string; status: "pending" | "executed"; approvals: number; threshold: number; erasedRows?: number }> {
  const existing = await findPendingRequest(didHash);

  if (!existing) {
    const id = uuidv4();
    await query(
      `INSERT INTO erasure_requests (id, did_hash, requested_by, reason, approvals, threshold, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [id, didHash, actor, reason ?? null, [actor], DEFAULT_THRESHOLD]
    );
    await logAudit(id, actor, "requested", reason);
    return { id, status: "pending", approvals: 1, threshold: DEFAULT_THRESHOLD };
  }

  if (existing.approvals.includes(actor)) {
    // Same admin calling again does not add a second approval — a single
    // session can never push a request across the threshold alone.
    return {
      id: existing.id,
      status: existing.status as "pending" | "executed",
      approvals: existing.approvals.length,
      threshold: existing.threshold,
    };
  }

  const approvals = Array.from(new Set([...existing.approvals, actor]));
  await query(`UPDATE erasure_requests SET approvals = $1 WHERE id = $2`, [approvals, existing.id]);
  await logAudit(existing.id, actor, "approved", reason);

  if (approvals.length < existing.threshold) {
    return { id: existing.id, status: "pending", approvals: approvals.length, threshold: existing.threshold };
  }

  // Threshold reached — write the audit entry BEFORE destroying the key
  // material, since after destruction this event is by definition
  // unrecoverable from the vault itself.
  await logAudit(existing.id, actor, "executed", "approval threshold reached — destroying key material");
  const result = await eraseAllForUser(didHash);
  await query(`UPDATE erasure_requests SET status = 'executed', executed_at = now() WHERE id = $1`, [existing.id]);

  return {
    id: existing.id,
    status: "executed",
    approvals: approvals.length,
    threshold: existing.threshold,
    erasedRows: result.erasedRows,
  };
}
