#!/usr/bin/env bash
# TrustMesh — one-time Fabric prerequisite install.
#
# Downloads the official fabric-samples checkout, the Fabric binaries
# (peer, configtxgen, cryptogen, fabric-ca-client, ...) and the Docker images
# into $FABRIC_SAMPLES's parent directory. Safe to re-run.
#
#   ./fabric/install.sh
#
# The migration proposal's §9 is explicit that hand-rolled Fabric config is
# where teams lose time, so we use the official samples exactly as documented
# and extend them to 3 orgs via the samples' own addOrg3 script.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source fabric/network-env.sh

FABRIC_VERSION="${FABRIC_VERSION:-2.5.16}"
CA_VERSION="${CA_VERSION:-1.5.17}"
INSTALL_ROOT="$(dirname "$FABRIC_SAMPLES")"

command -v docker >/dev/null || { echo "docker not on PATH" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker daemon is not running — start Docker Desktop first." >&2; exit 1; }

mkdir -p "$INSTALL_ROOT"
cd "$INSTALL_ROOT"

if [ ! -f install-fabric.sh ]; then
  echo "==> Fetching install-fabric.sh"
  curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
  chmod +x install-fabric.sh
fi

echo "==> Installing Fabric $FABRIC_VERSION / CA $CA_VERSION (samples, binaries, docker images)"
./install-fabric.sh --fabric-version "$FABRIC_VERSION" --ca-version "$CA_VERSION" docker samples binary

echo
echo "==> Installed:"
"$FABRIC_SAMPLES/bin/peer" version | head -4
echo
echo "Next: ./fabric/network-up.sh"
