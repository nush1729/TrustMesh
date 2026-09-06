#!/usr/bin/env bash
# TrustMesh — bring up the 3-organization Fabric network.
#
#   ./fabric/network-up.sh
#
# Topology (migration proposal §3, §5.3): the official fabric-samples
# test-network, extended to 3 organizations via its own addOrg3 script, so the
# three named governance signers each map onto a real, separately-endorsing
# organization:
#
#   Org1MSP -> IssuingDept          Org2MSP -> AuditOrg          Org3MSP -> IndependentVerifier
#
# CouchDB is the state database from the very first bring-up, not a later
# retrofit: the chaincode needs rich queries ("all assets owned by X",
# "all roles for a DID"), which Fabric's default LevelDB cannot serve.
# See migration proposal §9, "Rich lookups".
#
# §9 also flags network bring-up as the flakiest part of Fabric. The fix used
# here is explicit sequencing: each stage waits for the previous stage to be
# genuinely ready (polling the ledger, not sleeping a fixed interval) before
# the next begins, and the whole thing ends in a hard verification gate.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$PWD"
source fabric/network-env.sh

[ -d "$TEST_NETWORK" ] || { echo "fabric-samples not found at $FABRIC_SAMPLES — run ./fabric/install.sh first." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker daemon is not running — start Docker Desktop first." >&2; exit 1; }

# wait_for_channel <org#> — poll until that org's peer can read the channel.
wait_for_channel() {
  local org="$1" tries=0
  setOrg "$org"
  until peer channel getinfo -c "$CHANNEL_NAME" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge 30 ]; then
      echo "Org$org peer never became ready on channel '$CHANNEL_NAME'" >&2
      return 1
    fi
    sleep 2
  done
  echo "    Org$org peer ready on '$CHANNEL_NAME'"
}

cd "$TEST_NETWORK"

echo "==> [1/4] Tearing down any previous network"
./network.sh down >/dev/null 2>&1 || true
# addOrg3 leaves its own containers/volumes behind on an unclean exit.
(cd addOrg3 && ./addOrg3.sh down >/dev/null 2>&1) || true

echo "==> [2/4] Starting Org1 + Org2 with CouchDB and Fabric CAs, creating channel '$CHANNEL_NAME'"
./network.sh up createChannel -ca -s couchdb -c "$CHANNEL_NAME" >/dev/null

wait_for_channel 1
wait_for_channel 2

echo "==> [3/4] Adding Org3"
(cd addOrg3 && ./addOrg3.sh up -c "$CHANNEL_NAME" -ca -s couchdb >/dev/null)

wait_for_channel 3

echo "==> [4/4] Verifying"
cd "$REPO_ROOT"
./fabric/verify-network.sh
