import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
// Importing the server also applies its `express-async-errors` patch, which is
// global to express — that is what makes the probe router below behave.
import { app, errorHandler } from '../../src/server.fabric';

/**
 * REGRESSION TEST — an async route handler that throws must reach the error
 * handler, not terminate the process.
 *
 * Found by exercising the UI rather than by a test: a misconfigured vault key
 * made /identity/digilocker-import throw inside an async handler, and because
 * Express 4 does not catch rejections from async handlers, Node treated it as
 * an unhandled rejection and killed the backend. The browser saw "Failed to
 * fetch" — the server was simply gone.
 *
 * That made every async route in the API a remote crash vector: any input that
 * could provoke an unexpected throw would take down the whole service, not
 * just the one request. The fix is the `import 'express-async-errors'` at the
 * top of server.fabric.ts.
 *
 * This test pins the behaviour so it cannot silently regress if that import is
 * ever removed or reordered below the route definitions (where it would have
 * no effect).
 */
describe('async error handling', () => {
  it('routes a throw from an async handler to the error handler instead of crashing', async () => {
    const probe = express();
    probe.get('/boom', async () => {
      throw new Error('sensitive internal detail: postgres constraint xyz');
    });
    probe.use(errorHandler);

    const res = await request(probe).get('/boom');

    expect(res.status).toBe(500);
    // Stage 1 P1.3: the real error must not reach the client, only a reference.
    expect(res.body.error).toBe('Internal error. Contact support with this reference.');
    expect(res.body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(res.body)).not.toContain('postgres');
  });

  it('keeps serving requests after a handler has thrown', async () => {
    // The decisive assertion: the real app is still alive and answering. Before
    // the fix, the process would already be dead by this point.
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
  });

  it('still rejects unauthenticated requests to protected routes', async () => {
    expect((await request(app).get('/audit/feed')).status).toBe(401);
  });
});
