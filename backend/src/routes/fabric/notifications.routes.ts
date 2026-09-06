import { Router } from 'express';
import { AuthedRequest } from '../../fabric/auth.middleware';
import { listNotifications, markAllRead } from '../../fabric/notifications.service';

/**
 * Item 1 (guardian notifications) + item 3 (new-device alerts) surface here.
 * Session-scoped: a caller only ever sees notifications addressed to THEIR
 * OWN did_hash, derived from the session exactly like every other route in
 * this backend — never from a query param or body field, so one user cannot
 * read another's notification feed by guessing a DID hash.
 */
export const notificationsRouter = Router();

notificationsRouter.get('/', async (req: AuthedRequest, res) => {
  const notifications = await listNotifications(req.didHash!);
  res.json({ notifications });
});

notificationsRouter.post('/read', async (req: AuthedRequest, res) => {
  await markAllRead(req.didHash!);
  res.json({ ok: true });
});
