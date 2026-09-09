#!/usr/bin/env bash
# TrustMesh — bring up the 3-organization Fabric network.
#
#   ./fabric/network-up.sh              # fresh network — DESTROYS existing ledger state
#   ./fabric/network-up.sh --preserve   # never destroys state; verifies a running network
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
#
# ---------------------------------------------------------------------------
# WHY --preserve EXISTS
# ---------------------------------------------------------------------------
# The default path begins by tearing the network down, and test-network's
# teardown removes the CouchDB volumes along with the containers. That means a
# plain re-run is DESTRUCTIVE: every registered DID, every granted role and
# every minted asset is gone, and the ledger restarts empty.
#
# That is correct for a clean rebuild and wrong in the two situations where
# someone is most likely to re-run this script by reflex: a demo where the
# state was seeded by hand, and any environment where the ledger is the record
# rather than scratch. Docker hiccuping, a laptop waking from sleep, or a
# nervous second run are all it takes.
#
# --preserve makes the safe path explicit and, more importantly, makes it
# GUARANTEED: it will not tear anything down, and if it cannot find a running
# network to preserve it stops rather than quietly doing the destructive thing
# under a flag whose whole purpose was to avoid that.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$PWD"
source fabric/network-env.sh

PRESERVE=false

# The usage text is the file's own header comment (lines 2-5), so the two can
# never drift apart.
usage() {
  sed -n '2,5p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --preserve|--keep) PRESERVE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "network-up.sh: unknown option '$1'" >&2; usage >&2; exit 2 ;;
  esac
done

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

# network_is_up — true when Org1's peer answers on the channel, which is the
# only evidence that matters here: containers can be running while the channel
# is unreadable, and that is not a network worth preserving.
network_is_up() {
  ( setOrg 1 && cd "$TEST_NETWORK" && peer channel getinfo -c "$CHANNEL_NAME" ) >/dev/null 2>&1
}

if [ "$PRESERVE" = true ]; then
  if network_is_up; then
    echo "==> --preserve: channel '$CHANNEL_NAME' is already live. Nothing torn down, ledger untouched."
    echo
    exec ./fabric/verify-network.sh
  fi

  cat >&2 <<EOF
--preserve was requested, but no running network answered on channel '$CHANNEL_NAME'.

Stopping rather than continuing. Bringing the network up from here would create
a FRESH ledger with no DIDs, roles or assets in it — which is exactly the
outcome --preserve exists to prevent, so doing it silently under this flag
would be worse than doing nothing.

If the network should be running, check it first:
    docker ps --filter name=peer0.org1 --filter name=orderer

If you genuinely want a fresh network (this DESTROYS all existing ledger state):
    ./fabric/network-up.sh
EOF
  exit 1
fi

cd "$TEST_NETWORK"

echo "==> [1/4] Tearing down any previous network"
echo "    NOTE: this removes the CouchDB volumes — every DID, role and asset on"
echo "    the current ledger is destroyed. Use --preserve to keep a running network."
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
