import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/server.fabric';
import { closeGateways, pingChaincode } from '../../src/fabric/gateway';
import { startIndexer, stopIndexer } from '../../src/fabric/indexer.service';
import { bootstrapRole, loginAs, MINIMAL_VALID_PDF, newCitizen, registerCitizen, TestCitizen } from './helpers';

/**
 * V3 REGRESSION SUITE — no content-type/magic-byte validation on asset
 * uploads (security audit §9/§V3).
 *
 * Audit's live proof: an SVG carrying an embedded `<script>` tag, sent with
 * a mismatched Content-Type, was accepted by POST /assets/mint and
 * permanently anchored — zero validation of the actual file content.
 *
 * fabric/file-type.service.ts now sniffs the real bytes against an explicit
 * allowlist (PDF, PNG, JPEG, DOCX/XLSX/PPTX), regardless of what the client
 * claims. This suite proves: a genuinely allowed type still mints
 * successfully, and the audit's exact disguised-SVG attack is now rejected.
 */

let admin: TestCitizen;
let adminAgent: request.SuperAgentTest;

beforeAll(async () => {
  await pingChaincode();
  startIndexer();

  admin = newCitizen();
  await registerCitizen(app, admin);
  await bootstrapRole('Admin', admin.didHash, undefined, 'org1');
  adminAgent = await loginAs(app, admin);
}, 180_000);

afterAll(async () => {
  stopIndexer();
  await closeGateways();
});

describe('V3: asset uploads are validated by real magic bytes, not client-declared type', () => {
  it('accepts a real allowed file type (PDF)', async () => {
    const owner = newCitizen();
    await registerCitizen(app, owner);

    const res = await adminAgent
      .post('/assets/mint')
      .field('to', owner.didHash)
      .field('encrypted', 'false')
      .attach('file', MINIMAL_VALID_PDF, 'legit.pdf');

    expect(res.status).toBe(200);
    expect(res.body.ipfsCID).toBeTruthy();
  });

  it('accepts a real allowed file type (PNG) even when the client mislabels the filename', async () => {
    const owner = newCitizen();
    await registerCitizen(app, owner);

    const pngBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32), // fabricated IHDR-region padding — only the leading magic bytes are checked
    ]);

    const res = await adminAgent
      .post('/assets/mint')
      .field('to', owner.didHash)
      .field('encrypted', 'false')
      // Filename claims .exe — sniffing must not trust the extension either.
      .attach('file', pngBytes, 'totally-not-an-image.exe');

    expect(res.status).toBe(200);
  });

  it('rejects the audit exploit: an SVG with an embedded <script>, sent with a mismatched Content-Type', async () => {
    const owner = newCitizen();
    await registerCitizen(app, owner);

    const maliciousSvg = Buffer.from(
      `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>`,
      'utf8'
    );

    const res = await adminAgent
      .post('/assets/mint')
      .field('to', owner.didHash)
      .field('encrypted', 'false')
      // Mismatched Content-Type, exactly like the audit's reproduction —
      // claims image/png while the bytes are actually SVG/XML/script.
      .attach('file', maliciousSvg, { filename: 'certificate.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unrecognized|disallowed/i);
    expect(res.body.allowed).toEqual(expect.arrayContaining(['pdf', 'png', 'jpg']));
  });

  it('rejects plain HTML content outright, regardless of declared type', async () => {
    const owner = newCitizen();
    await registerCitizen(app, owner);

    const html = Buffer.from('<html><body><script>alert(1)</script></body></html>', 'utf8');

    const res = await adminAgent
      .post('/assets/mint')
      .field('to', owner.didHash)
      .field('encrypted', 'false')
      .attach('file', html, { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
  });

  // V7 regression: an oversized upload used to fall through to a generic
  // 500 ("internal error, contact support") instead of a proper 413 that
  // actually says what went wrong. See server.fabric.ts's errorHandler,
  // which now checks multer's own `err.code === 'LIMIT_FILE_SIZE'` first.
  it('V7: an oversized upload returns 413, not a generic 500', async () => {
    const owner = newCitizen();
    await registerCitizen(app, owner);

    const oversized = Buffer.concat([MINIMAL_VALID_PDF, Buffer.alloc(11 * 1024 * 1024)]); // >10MB cap

    const res = await adminAgent
      .post('/assets/mint')
      .field('to', owner.didHash)
      .field('encrypted', 'false')
      .attach('file', oversized, 'huge.pdf');

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/size limit|10MB/i);
  });
});
