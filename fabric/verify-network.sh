#!/usr/bin/env bash
# TrustMesh — Phase 1 verification.
#
# Proves the completion criteria from docs/IMPLEMENTATION_PROMPT.md Stage 2 Phase 1:
#   "3-org Fabric test-network stable, MSPs generated and verified,
#    peers/orderer/CAs reachable."
#
# This asserts rather than prints: it exits non-zero on the first real failure,
# so it is usable as a gate before starting Phase 2.
#
#   ./fabric/verify-network.sh

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source fabric/network-env.sh

FAILED=0
pass() { printf '  \033[0;32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[0;31mFAIL\033[0m  %s\n' "$1"; FAILED=$((FAILED + 1)); }

echo "TrustMesh Fabric network verification (channel: $CHANNEL_NAME)"
echo

# --- 1. Containers ------------------------------------------------------------
echo "[1/5] Containers"
for c in orderer.example.com \
         peer0.org1.example.com peer0.org2.example.com peer0.org3.example.com \
         ca_org1 ca_org2 ca_org3 ca_orderer \
         couchdb0 couchdb1 couchdb4; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then
    pass "$c running"
  else
    fail "$c not running"
  fi
done

# --- 2. MSP material ----------------------------------------------------------
echo
echo "[2/5] MSP material"
for o in 1 2 3; do
  base="$TEST_NETWORK/organizations/peerOrganizations/org$o.example.com"
  for p in "msp/cacerts" "users/Admin@org$o.example.com/msp/signcerts" \
           "users/Admin@org$o.example.com/msp/keystore" "tlsca"; do
    if [ -d "$base/$p" ] && [ -n "$(ls -A "$base/$p" 2>/dev/null)" ]; then
      pass "Org$o $p"
    else
      fail "Org$o $p missing or empty"
    fi
  done
  # The admin signcert must actually be an X.509 cert, not a stray file.
  cert=$(ls "$base/users/Admin@org$o.example.com/msp/signcerts/"* 2>/dev/null | head -1)
  if [ -n "$cert" ] && openssl x509 -in "$cert" -noout -subject >/dev/null 2>&1; then
    pass "Org$o admin signcert is a valid X.509 certificate"
  else
    fail "Org$o admin signcert is not a valid X.509 certificate"
  fi
done
if [ -d "$TEST_NETWORK/organizations/ordererOrganizations/example.com/msp" ]; then
  pass "orderer org MSP"
else
  fail "orderer org MSP missing"
fi

# --- 3. Every org sees the channel at the same height --------------------------
echo
echo "[3/5] Channel membership and ledger consistency"
heights=()
for o in 1 2 3; do
  setOrg "$o"
  info=$(peer channel getinfo -c "$CHANNEL_NAME" 2>&1)
  h=$(echo "$info" | sed -n 's/.*"height":\([0-9]*\).*/\1/p')
  if [ -n "$h" ]; then
    pass "Org$o peer is on channel '$CHANNEL_NAME' at height $h"
    heights+=("$h")
  else
    fail "Org$o peer could not read channel '$CHANNEL_NAME': $info"
  fi
done
if [ "${#heights[@]}" -eq 3 ] && [ "${heights[0]}" = "${heights[1]}" ] && [ "${heights[1]}" = "${heights[2]}" ]; then
  pass "all 3 peers agree on ledger height (${heights[0]})"
else
  fail "peers disagree on ledger height: ${heights[*]:-none}"
fi

# --- 4. Orderer and CAs reachable ---------------------------------------------
echo
echo "[4/5] Orderer and CA reachability"
if nc -z localhost 7050 2>/dev/null; then
  pass "orderer reachable on localhost:7050"
else
  fail "orderer not reachable on localhost:7050"
fi
for ca in "ca_org1:7054" "ca_org2:8054" "ca_org3:11054" "ca_orderer:9054"; do
  name="${ca%%:*}"; port="${ca##*:}"
  if curl -sk --max-time 5 "https://localhost:$port/cainfo" | grep -q '"CAName"'; then
    pass "$name responds on https://localhost:$port/cainfo"
  else
    fail "$name did not return CA info on port $port"
  fi
done

# --- 5. CouchDB state database -------------------------------------------------
# CouchDB (not LevelDB) is required for the rich queries the chaincode needs --
# see migration proposal §9 ("Rich lookups").
echo
echo "[5/5] CouchDB state database"
for db in "couchdb0:5984" "couchdb1:7984" "couchdb4:9984"; do
  name="${db%%:*}"; port="${db##*:}"
  if curl -s --max-time 5 "http://admin:adminpw@localhost:$port/" | grep -q '"couchdb"'; then
    pass "$name responds on localhost:$port"
  else
    fail "$name did not respond on localhost:$port"
  fi
done

echo
if [ "$FAILED" -eq 0 ]; then
  printf '\033[0;32mAll checks passed — 3-org network verified.\033[0m\n'
  exit 0
fi
printf '\033[0;31m%d check(s) failed.\033[0m\n' "$FAILED"
exit 1
