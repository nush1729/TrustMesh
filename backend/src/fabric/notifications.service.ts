import { query } from '../db/client';

/**
 * MOCKED notification channel.
 *
 * This project has no SendGrid/Twilio/etc. key configured anywhere (by
 * design — the ground rules for this feature explicitly rule out adding a
 * new paid external dependency), so there is nowhere for these notifications
 * to actually get delivered as email or SMS. Instead, "sending" a
 * notification durably records it in Postgres (see the `notifications` table
 * in db/schema.sql) and it is surfaced to the recipient's own session via
 * `GET /notifications` — a bell/list UI (frontend/components/NotificationBell.tsx)
 * polls that endpoint.
 *
 * WHERE A REAL PROVIDER WOULD PLUG IN: `dispatchNotification` below is the
 * single choke point. In production this function's body would additionally
 * call something like `sendgrid.send({...})` / `twilioClient.messages.create({...})`
 * using the subject/body already computed here — the realistic email/SMS
 * copy is written now so that swap is copy-paste, not a rewrite. Until then
 * it only persists the row.
 */

export type NotificationType = 'RECOVERY_PROPOSED' | 'RECOVERY_VOTE' | 'RECOVERY_EXECUTED' | 'NEW_DEVICE_LOGIN';

export interface NotificationRecord {
  id: string;
  did_hash: string;
  type: NotificationType;
  channel: string;
  subject: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

/**
 * Writes the notification row ("delivers" it, in mock terms) and returns it.
 * `didHash` is always the identity the notification is ABOUT — i.e. the
 * actual DID owner — never the actor who triggered it, so a hijacker who
 * proposes/votes a recovery cannot suppress or redirect the alert.
 */
async function dispatchNotification(
  didHash: string,
  type: NotificationType,
  subject: string,
  body: string
): Promise<NotificationRecord> {
  // MOCK CHANNEL: a real integration (SendGrid email / Twilio SMS) would send
  // `subject` + `body` to the citizen's registered contact address/number
  // right here, e.g.:
  //   await sendgrid.send({ to: contactEmailFor(didHash), subject, text: body });
  // No such provider is configured in this project, so the only "delivery"
  // is this durable row plus a server log line, both clearly marked mock.
  console.log(`[MOCK NOTIFICATION -> ${didHash.slice(0, 12)}…] (${type}) ${subject}`);

  const rows = await query<NotificationRecord>(
    `INSERT INTO notifications (did_hash, type, channel, subject, body)
     VALUES ($1, $2, 'mock', $3, $4)
     RETURNING *`,
    [didHash, type, subject, body]
  );
  return rows[0];
}

/** A recovery was just proposed against `didHash` by `proposedBy` (a guardian id). */
export async function notifyRecoveryProposed(didHash: string, proposedBy: string, requestId: string) {
  return dispatchNotification(
    didHash,
    'RECOVERY_PROPOSED',
    'Security alert: a recovery request was opened for your TrustMesh identity',
    `A guardian recovery request (#${requestId.slice(0, 8)}) was just proposed for your DID, ` +
      `which would replace the key that controls it with a new one. It was proposed by guardian ` +
      `${proposedBy.slice(0, 16)}…. If you did not expect this, contact your other guardians ` +
      `immediately and ask them to withhold their vote — a request only executes once enough ` +
      `guardians approve it.`
  );
}

/** One more guardian vote landed on an in-progress recovery request. */
export async function notifyRecoveryVote(
  didHash: string,
  guardianId: string,
  votes: number,
  threshold: number
) {
  return dispatchNotification(
    didHash,
    'RECOVERY_VOTE',
    `Recovery request update: ${votes}/${threshold} guardian votes collected`,
    `Guardian ${guardianId.slice(0, 16)}… just voted on the recovery request open against your ` +
      `TrustMesh identity. It now has ${votes} of the ${threshold} votes required to execute. ` +
      `If this recovery is unexpected, reach your remaining guardians now — once the threshold is ` +
      `reached the identity's controller is reassigned.`
  );
}

/** The recovery reached threshold and the controller update has been submitted for execution. */
export async function notifyRecoveryExecuted(didHash: string, proposalId: string) {
  return dispatchNotification(
    didHash,
    'RECOVERY_EXECUTED',
    'Your TrustMesh identity has been recovered to a new key',
    `Guardian recovery for your DID reached its approval threshold and the controller update has ` +
      `been submitted to governance for execution (proposal ${proposalId.slice(0, 8)}…). Your old ` +
      `device key will no longer be able to sign in once this settles. If you did not initiate or ` +
      `expect this, this is now the most important message in your inbox.`
  );
}

/** A login succeeded from a device fingerprint never seen before for this DID. */
export async function notifyNewDeviceLogin(didHash: string) {
  return dispatchNotification(
    didHash,
    'NEW_DEVICE_LOGIN',
    'New sign-in detected from an unrecognized device',
    `Your TrustMesh identity was just used to sign in from a device/browser we haven't seen before ` +
      `for this DID. If this was you, no action is needed. If it wasn't, your device key may be in ` +
      `someone else's hands — guardian recovery is the way to move your identity to a new key.`
  );
}

/** Session-scoped read: the current user's own notifications, newest first. */
export async function listNotifications(didHash: string, limit = 50): Promise<NotificationRecord[]> {
  return query<NotificationRecord>(
    `SELECT * FROM notifications WHERE did_hash = $1 ORDER BY created_at DESC LIMIT $2`,
    [didHash, limit]
  );
}

export async function markAllRead(didHash: string): Promise<void> {
  await query(`UPDATE notifications SET read_at = now() WHERE did_hash = $1 AND read_at IS NULL`, [didHash]);
}
