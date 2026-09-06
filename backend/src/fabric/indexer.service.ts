import { ChaincodeEvent, CloseableAsyncIterable, checkpointers, Checkpointer } from '@hyperledger/fabric-gateway';
import { fabricConfig } from './config';
import { getNetwork } from './gateway';
import { HASH_TO_ROLE_NAME } from './identity';

/**
 * AUDIT INDEXER — replaces services/indexer.service.ts.
 *
 * The EVM version polled `queryFilter` over a block range every 15 seconds and
 * kept a `lastScannedBlock` in a module variable. That pattern does not survive
 * a restart (the variable resets and it re-scans a fixed 50k-block window) and
 * has no way to resume mid-block.
 *
 * §9 names event-indexing reliability as a problem to solve from day one rather
 * than retrofit: "Fabric's event model differs from Ethereum's; naive listening
 * loses events on reconnect." So this is built as a DURABLE, CHECKPOINTED
 * listener from the start:
 *
 *   - It streams chaincode events rather than polling, so nothing is missed
 *     between poll intervals.
 *   - Every processed event is committed to a file checkpointer
 *     (fabric-gateway's own `checkpointers.file`), which survives process
 *     restarts and records block number AND transaction id, so resumption is
 *     exact rather than approximate.
 *   - On any stream error it reconnects and resumes FROM THE CHECKPOINT, so a
 *     dropped connection replays nothing and skips nothing.
 *
 * PII: the feed is safe to expose because there is no PII on the ledger to
 * leak. Every field below is a hash, an opaque id or a timestamp — the same
 * property the EVM indexer relied on.
 */

export type AuditEventType =
  | 'DID_REGISTERED'
  | 'CONTROLLER_UPDATED'
  | 'ROLE_GRANTED'
  | 'ROLE_REVOKED'
  | 'ASSET_MINTED'
  | 'ASSET_TRANSFERRED'
  | 'CREDENTIAL_REVOKED'
  | 'PROPOSAL_CREATED'
  | 'PROPOSAL_APPROVED';

export type AuditEvent = {
  id: string;
  type: AuditEventType;
  actor: string;
  target: string;
  timestamp: string;
  txHash: string;
  blockNumber: string;
  /** Who proposed and who approved, for governed actions — the §3 audit trail. */
  governance?: { proposalId?: string; proposedBy?: string; approvals?: Array<{ mspId: string; signer: string }> };
};

/** Chaincode event name -> audit feed type. */
const EVENT_TYPES: Record<string, AuditEventType> = {
  DIDRegistered: 'DID_REGISTERED',
  ControllerUpdated: 'CONTROLLER_UPDATED',
  RoleGrantedWithExpiry: 'ROLE_GRANTED',
  RoleRevokedEarly: 'ROLE_REVOKED',
  AssetMinted: 'ASSET_MINTED',
  AssetTransferred: 'ASSET_TRANSFERRED',
  StatusChanged: 'CREDENTIAL_REVOKED',
  ProposalCreated: 'PROPOSAL_CREATED',
  ProposalApproved: 'PROPOSAL_APPROVED',
};

const MAX_CACHED_EVENTS = 1000;

let cache: AuditEvent[] = [];
let running = false;
let stream: CloseableAsyncIterable<ChaincodeEvent> | undefined;
let checkpointer: Checkpointer | undefined;

const decoder = new TextDecoder();

function toAuditEvent(event: ChaincodeEvent): AuditEvent | null {
  const type = EVENT_TYPES[event.eventName];
  if (!type) return null;

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(decoder.decode(event.payload)) as Record<string, unknown>;
  } catch {
    // An event whose payload will not parse is still worth recording as having
    // happened; we just cannot describe its subject.
  }

  // StatusChanged fires for every status write, including the un-revocation
  // that accompanies a fresh role grant. Only an actual revocation is an
  // audit-worthy CREDENTIAL_REVOKED, matching the EVM indexer's behaviour.
  if (event.eventName === 'StatusChanged' && payload.revoked !== true) return null;

  const str = (k: string): string => (payload[k] === undefined ? '' : String(payload[k]));
  const roleLabel = (hash: string): string => HASH_TO_ROLE_NAME[hash] ?? hash;

  let actor = '';
  let target = '';
  switch (type) {
    case 'DID_REGISTERED':
      actor = str('didHash');
      target = str('did');
      break;
    case 'CONTROLLER_UPDATED':
      actor = str('didHash');
      target = 'controller-rotated';
      break;
    case 'ROLE_GRANTED':
    case 'ROLE_REVOKED':
      actor = str('subject');
      target = roleLabel(str('roleId'));
      break;
    case 'ASSET_MINTED':
      actor = str('to');
      target = `assetId:${str('assetId')}`;
      break;
    case 'ASSET_TRANSFERRED':
      actor = str('from');
      target = str('to');
      break;
    case 'CREDENTIAL_REVOKED':
      actor = 'revocation-registry';
      target = str('statusId');
      break;
    case 'PROPOSAL_CREATED':
    case 'PROPOSAL_APPROVED':
      actor = str('proposedBy');
      target = str('actionType');
      break;
  }

  const approvals = Array.isArray(payload.approvals)
    ? (payload.approvals as Array<{ mspId: string; signer: string }>).map((a) => ({
        mspId: a.mspId,
        signer: a.signer,
      }))
    : undefined;

  return {
    id: `${event.transactionId}-${event.eventName}`,
    type,
    actor,
    target,
    // The chaincode stamps every payload with the transaction timestamp, so the
    // feed's ordering matches ledger order rather than wall-clock arrival order.
    timestamp: str('timestamp') || new Date(0).toISOString(),
    txHash: event.transactionId,
    blockNumber: String(event.blockNumber),
    governance:
      payload.proposalId || approvals
        ? { proposalId: str('proposalId') || undefined, proposedBy: str('proposedBy') || undefined, approvals }
        : undefined,
  };
}

async function consume(): Promise<void> {
  const network = await getNetwork();
  checkpointer = checkpointer ?? (await checkpointers.file(fabricConfig.checkpointFile));

  // Resuming from the checkpoint is what makes a reconnect lossless: the stream
  // restarts at the last committed block rather than at "now" (which would drop
  // everything that happened while disconnected) or at block 0 (which would
  // replay the whole chain on every restart).
  stream = await network.getChaincodeEvents(fabricConfig.chaincodeName, {
    checkpoint: checkpointer,
    startBlock: BigInt(0),
  });

  for await (const event of stream) {
    const audit = toAuditEvent(event);
    if (audit && !cache.some((e) => e.id === audit.id)) {
      cache.unshift(audit);
      if (cache.length > MAX_CACHED_EVENTS) cache.length = MAX_CACHED_EVENTS;
    }
    // Checkpoint AFTER processing, never before: a crash between the two
    // replays one event (harmless — the cache dedupes by id) rather than
    // losing it, which is the correct direction to fail in for an audit trail.
    await checkpointer.checkpointChaincodeEvent(event);
  }
}

/**
 * Start the indexer, reconnecting with backoff on failure.
 * Replaces startIndexerPolling().
 */
export function startIndexer(): void {
  if (running) return;
  running = true;

  void (async () => {
    let backoffMs = 1000;
    while (running) {
      try {
        await consume();
        backoffMs = 1000; // clean end of stream — reset backoff
      } catch (err) {
        if (!running) return;
        console.error('[indexer] event stream error, resuming from checkpoint:', (err as Error).message);
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    }
  })();
}

export function stopIndexer(): void {
  running = false;
  stream?.close();
  stream = undefined;
}

export function getCachedAuditFeed(): AuditEvent[] {
  return cache;
}

/**
 * Wait until the indexer has caught up enough to contain `predicate`.
 * Used by the end-to-end tests so they assert on a settled feed rather than
 * racing the event stream.
 */
export async function waitForEvent(
  predicate: (e: AuditEvent) => boolean,
  timeoutMs = 20_000
): Promise<AuditEvent | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = cache.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}
