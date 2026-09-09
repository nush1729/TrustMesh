/**
 * V3 FIX — magic-byte file-type detection for asset uploads.
 *
 * Audit finding (§9/§V3): POST /assets/mint accepted arbitrary file content
 * with zero validation — a client-declared Content-Type/extension was
 * trusted entirely. Live proof: an SVG carrying an embedded `<script>`,
 * sent with a mismatched Content-Type, was accepted and permanently
 * anchored (CID + on-chain contentHash), with no check that would have
 * caught it.
 *
 * This sniffs the actual bytes rather than trusting anything the client
 * asserts, and is intentionally hand-rolled rather than built on the
 * `file-type` npm package: the only version range of that package that
 * still supports CommonJS `require()` (<=16.x, since v17 went pure ESM) is
 * exactly the range with an open DoS advisory in its parser
 * (GHSA-5v7r-6r5c-r473, infinite loop on malformed input) reachable by
 * definition from untrusted upload bytes; the patched versions are ESM-only
 * and TypeScript silently downlevels a CJS project's `await import(...)` of
 * them to `require(...)` when compiled for production (`tsc` + `node
 * dist/server.fabric.js`), which would throw ERR_REQUIRE_ESM at runtime —
 * not something to discover after this ships. A small, explicit allowlist of
 * magic-byte signatures for exactly the file types this "institutional
 * documents" use case needs avoids both problems and is easy to audit in
 * full.
 *
 * Deliberately EXCLUDED: anything HTML/SVG/script-executable, and any
 * format (audio/video containers, archives in general) outside the
 * allowlist below — those are exactly the vectors the audit's SVG/script
 * exploit and general "anchor anything forever" concern were about.
 */

export interface DetectedFileType {
  ext: string;
  mime: string;
}

function isZipMagic(b: Buffer): boolean {
  return (
    b.length >= 4 &&
    b[0] === 0x50 &&
    b[1] === 0x4b &&
    (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07) &&
    (b[3] === 0x04 || b[3] === 0x06 || b[3] === 0x08)
  );
}

/**
 * Office Open XML formats (.docx/.xlsx/.pptx) are ZIP containers whose
 * top-level part directory (word/, xl/, ppt/) appears within the first local
 * file headers — well within a small leading window — so this never needs to
 * parse the whole (potentially large) archive to disambiguate them from a
 * generic .zip.
 */
function isOfficeZip(b: Buffer, marker: string): boolean {
  if (!isZipMagic(b)) return false;
  const window = b.subarray(0, Math.min(b.length, 8192));
  return window.includes(Buffer.from(marker, 'latin1'));
}

const SIGNATURES: Array<{ ext: string; mime: string; matches: (b: Buffer) => boolean }> = [
  {
    ext: 'pdf',
    mime: 'application/pdf',
    matches: (b) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-',
  },
  {
    ext: 'png',
    mime: 'image/png',
    matches: (b) =>
      b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: 'jpg',
    mime: 'image/jpeg',
    matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    matches: (b) => isOfficeZip(b, 'word/'),
  },
  {
    ext: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    matches: (b) => isOfficeZip(b, 'xl/'),
  },
  {
    ext: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    matches: (b) => isOfficeZip(b, 'ppt/'),
  },
];

/** The allowlist, for error messages and documentation — never mutated at runtime. */
export const ALLOWED_ASSET_FILE_TYPES = SIGNATURES.map((s) => ({ ext: s.ext, mime: s.mime }));

/** Sniffs the actual buffer content; returns null if it matches nothing in the allowlist. */
export function detectAllowedFileType(buffer: Buffer): DetectedFileType | null {
  for (const sig of SIGNATURES) {
    if (sig.matches(buffer)) return { ext: sig.ext, mime: sig.mime };
  }
  return null;
}
