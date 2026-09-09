#!/usr/bin/env bash
# TrustMesh — V1 fix support: bootstrap 3 Admin identities, one per Fabric
# organization, for local dev/testing of the governance quorum.
#
# Since POST /governance/approve now derives the approving organization from
# the caller's OWN recorded affiliation (fabric/org-membership.service.ts,
# security audit V1) rather than a client-supplied `org` field, exercising
# the real 2-of-3 flow locally requires at least two DIFFERENT logged-in
# identities, each affiliated with a different organization — one Admin
# session can no longer stand in for all three. This script creates exactly
# that: three real did:key identities (via fabric/tools/identity.js),
# registers each on the ledger (POST /identity/did), and bootstraps each as
# an org1/org2/org3-affiliated Admin (fabric/bootstrap.ts) in one step.
#
# Requires: the backend (`npm run dev:fabric`) already running and reachable,
# and the Fabric network + chaincode already up (see docs/ENV_SETUP.md).
#
#   ./fabric/tools/bootstrap-org-admins.sh [backend URL, default http://localhost:4000]
#
# Prints each identity's did/didHash/org, and saves the full identity JSON
# (including the private key, so you can actually log in as it — see
# docs/ENV_SETUP.md's "Bootstrapping org-affiliated admins for local dev"
# section for the login flow) to fabric/tools/generated/<org>-admin.json.
# That output directory is gitignored — these are throwaway local-dev
# identities, never anything to commit.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

BACKEND_URL="${1:-http://localhost:4000}"
OUT_DIR="fabric/tools/generated"
mkdir -p "$OUT_DIR"

if ! command -v jq >/dev/null 2>&1; then
  echo "This script requires 'jq' (brew install jq)." >&2
  exit 1
fi

for org in org1 org2 org3; do
  echo "== $org =="
  identity_json=$(node fabric/tools/identity.js new)
  echo "$identity_json" > "$OUT_DIR/${org}-admin.json"

  did=$(echo "$identity_json" | jq -r '.did')
  did_hash=$(echo "$identity_json" | jq -r '.didHash')
  public_key=$(echo "$identity_json" | jq -r '.publicKeyB64')
  signature=$(echo "$identity_json" | jq -r '.signatureB64')

  register_status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BACKEND_URL/identity/did" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg pk "$public_key" --arg sig "$signature" '{publicKey: $pk, signature: $sig}')")
  if [ "$register_status" != "200" ]; then
    echo "  FAILED to register DID (HTTP $register_status) — is the backend running at $BACKEND_URL?" >&2
    exit 1
  fi
  echo "  registered:  $did"
  echo "  didHash:     $did_hash"

  (cd backend && npx tsx src/fabric/bootstrap.ts "$did_hash" Admin 365 "$org")
  echo "  saved to:    $OUT_DIR/${org}-admin.json"
  echo
done

echo "Done. Three Admins are now provisioned, one per organization:"
echo "  $OUT_DIR/org1-admin.json, org2-admin.json, org3-admin.json"
echo "See docs/ENV_SETUP.md for how to log in as each and drive a real"
echo "2-of-3 governance approval end-to-end."
