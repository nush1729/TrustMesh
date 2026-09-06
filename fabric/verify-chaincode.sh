#!/usr/bin/env bash
# TrustMesh — Phase 2 verification.
#
#   ./fabric/verify-chaincode.sh [single|multi]
#
# Proves the Phase 2 completion criteria from docs/IMPLEMENTATION_PROMPT.md:
#   "all functions individually verified via peer chaincode invoke/query,
#    negative-path endorsement test passing (a transaction genuinely fails
#    without required endorsements)."
#
# Everything runs through the real peer CLI against the real running network --
# no mocks, no unit-test harness standing in for the ledger.
#
# The negative cases matter as much as the happy path here. §9 warns it is
# "easy to build a policy that looks enforced but isn't", because teams only
# test the happy path. So this script asserts, with state re-read afterwards:
#   - a proposal with 1 of 2 approvals will not execute
#   - one organization cannot approve twice to fake a quorum
#   - registering a DID with a signature that does not match the key fails
#   - in multi mode, a write endorsed by only one org is REJECTED and the
#     ledger is genuinely unchanged

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source fabric/network-env.sh

MODE="${1:-multi}"
NODE_BIN="${NODE_BIN:-node}"

PASS=0; FAIL=0
pass() { printf '  \033[0;32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
fail() { printf '  \033[0;31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }

ORDERER_ARGS=(-o "$ORDERER_ADDRESS" --ordererTLSHostnameOverride "$ORDERER_HOSTNAME" --tls --cafile "$ORDERER_CA")

# Peers whose endorsements we collect. In multi mode the policy demands 2 of 3,
# so we must gather from two organizations; in single mode Org1 alone suffices.
if [ "$MODE" = "multi" ]; then
  ENDORSERS=(--peerAddresses "$PEER0_ORG1_ADDRESS" --tlsRootCertFiles "$PEER0_ORG1_CA"
             --peerAddresses "$PEER0_ORG2_ADDRESS" --tlsRootCertFiles "$PEER0_ORG2_CA")
else
  ENDORSERS=(--peerAddresses "$PEER0_ORG1_ADDRESS" --tlsRootCertFiles "$PEER0_ORG1_CA")
fi

# ccInvoke <org> <Contract:Func> [args...]
ccInvoke() {
  local org="$1"; shift
  local fn="$1"; shift
  setOrg "$org"
  local args_json
  args_json=$(printf '%s\n' "$fn" "$@" | "$NODE_BIN" -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      const a=d.split("\n");while(a.length&&a[a.length-1]==="")a.pop();
      process.stdout.write(JSON.stringify({Args:a}));});')
  peer chaincode invoke "${ORDERER_ARGS[@]}" -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" \
    "${ENDORSERS[@]}" --waitForEvent -c "$args_json" 2>&1
}

# ccQuery <org> <Contract:Func> [args...]
ccQuery() {
  local org="$1"; shift
  local fn="$1"; shift
  setOrg "$org"
  local args_json
  args_json=$(printf '%s\n' "$fn" "$@" | "$NODE_BIN" -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      const a=d.split("\n");while(a.length&&a[a.length-1]==="")a.pop();
      process.stdout.write(JSON.stringify({Args:a}));});')
  peer chaincode query -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" -c "$args_json" 2>&1
}

echo "TrustMesh chaincode verification (channel: $CHANNEL_NAME, policy mode: $MODE)"
echo

# --- Fixtures -----------------------------------------------------------------
CITIZEN_A=$("$NODE_BIN" fabric/tools/identity.js new)
CITIZEN_B=$("$NODE_BIN" fabric/tools/identity.js new)
jqf() { echo "$1" | "$NODE_BIN" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d)["'"$2"'"]));'; }

A_DID=$(jqf "$CITIZEN_A" did);      A_HASH=$(jqf "$CITIZEN_A" didHash)
A_PUB=$(jqf "$CITIZEN_A" publicKeyB64); A_SIG=$(jqf "$CITIZEN_A" signatureB64)
B_DID=$(jqf "$CITIZEN_B" did);      B_HASH=$(jqf "$CITIZEN_B" didHash)
B_PUB=$(jqf "$CITIZEN_B" publicKeyB64); B_SIG=$(jqf "$CITIZEN_B" signatureB64)
ADMIN_ROLE=$("$NODE_BIN" fabric/tools/identity.js rolehash TRUSTMESH_ADMIN_ROLE)
FUTURE=$(( $(date +%s) + 86400 ))
PAST=$(( $(date +%s) - 86400 ))

# --- 1. DIDRegistry -----------------------------------------------------------
echo "[1/7] DIDRegistry"
out=$(ccInvoke 1 "DIDRegistry:RegisterDID" "$A_DID" "$A_PUB" "$A_SIG")
if echo "$out" | grep -q 'status:200'; then pass "RegisterDID (citizen A, valid proof of possession)"
else fail "RegisterDID: $out"; fi

out=$(ccInvoke 1 "DIDRegistry:RegisterDID" "$B_DID" "$B_PUB" "$B_SIG")
if echo "$out" | grep -q 'status:200'; then pass "RegisterDID (citizen B)"
else fail "RegisterDID B: $out"; fi

out=$(ccQuery 2 "DIDRegistry:DIDExists" "$A_HASH")
[ "$out" = "true" ] && pass "DIDExists -> true (queried from Org2, a different org)" || fail "DIDExists: $out"

out=$(ccQuery 1 "DIDRegistry:GetController" "$A_HASH")
[ "$out" = "$A_PUB" ] && pass "GetController returns the registered public key" || fail "GetController: $out"

out=$(ccQuery 1 "DIDRegistry:GetDID" "$A_HASH")
echo "$out" | grep -q "$A_DID" && pass "GetDID returns the full record" || fail "GetDID: $out"

out=$(ccQuery 1 "DIDRegistry:DIDExists" "$(echo -n nonexistent | shasum -a 256 | cut -d' ' -f1)")
[ "$out" = "false" ] && pass "DIDExists -> false for an unknown DID" || fail "DIDExists(unknown): $out"

# NEGATIVE: proof of possession must actually be checked. Citizen B's signature
# does not match citizen A's key, so this must be refused.
out=$(ccInvoke 1 "DIDRegistry:RegisterDID" "$A_DID" "$A_PUB" "$B_SIG")
if echo "$out" | grep -q 'proof of possession failed'; then
  pass "NEGATIVE: RegisterDID with a mismatched signature is rejected"
else fail "NEGATIVE PoP not enforced: $out"; fi

# NEGATIVE: no double registration (mirrors the Solidity require()).
out=$(ccInvoke 1 "DIDRegistry:RegisterDID" "$A_DID" "$A_PUB" "$A_SIG")
if echo "$out" | grep -q 'already registered'; then pass "NEGATIVE: duplicate RegisterDID is rejected"
else fail "NEGATIVE duplicate not rejected: $out"; fi

# --- 2. Governance: propose / approve / execute --------------------------------
echo
echo "[2/7] Governance — propose / approve / execute (GRANT_ROLE)"
out=$(ccInvoke 1 "Governance:ProposeAction" "GRANT_ROLE" \
      "{\"roleId\":\"$ADMIN_ROLE\",\"subject\":\"$A_HASH\",\"expiry\":\"$FUTURE\"}")
if echo "$out" | grep -q 'status:200'; then pass "ProposeAction GRANT_ROLE (proposed by Org1 / IssuingDept)"
else fail "ProposeAction: $out"; fi

pending=$(ccQuery 1 "Governance:QueryPendingProposals")
PROP=$(echo "$pending" | "$NODE_BIN" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const p=JSON.parse(d);process.stdout.write(p[0]?p[0].proposalId:"");});')
[ -n "$PROP" ] && pass "QueryPendingProposals (CouchDB rich query) returned proposal ${PROP:0:12}..." \
  || fail "QueryPendingProposals returned nothing: $pending"

# The single most important assertion in this file: proposing is not doing.
out=$(ccQuery 1 "AccessControlRegistry:HasActiveRole" "$ADMIN_ROLE" "$A_HASH")
[ "$out" = "false" ] && pass "HasActiveRole still false — a proposal alone grants nothing" \
  || fail "role active before execution: $out"

# NEGATIVE: 1 of 2 approvals must not execute.
out=$(ccInvoke 1 "Governance:ExecuteProposal" "$PROP")
if echo "$out" | grep -q 'of 2 required approvals'; then
  pass "NEGATIVE: ExecuteProposal with 1 of 2 approvals is refused"
else fail "NEGATIVE threshold not enforced: $out"; fi

# NEGATIVE: the proposing org must not be able to approve again and self-quorum.
out=$(ccInvoke 1 "Governance:ApproveProposal" "$PROP")
if echo "$out" | grep -q 'already approved'; then
  pass "NEGATIVE: same organization approving twice is refused (no self-quorum)"
else fail "NEGATIVE double-approval not enforced: $out"; fi

out=$(ccInvoke 2 "Governance:ApproveProposal" "$PROP")
if echo "$out" | grep -q 'status:200'; then pass "ApproveProposal by Org2 / AuditOrg (second distinct org)"
else fail "ApproveProposal Org2: $out"; fi

out=$(ccInvoke 3 "Governance:ExecuteProposal" "$PROP")
if echo "$out" | grep -q 'status:200'; then pass "ExecuteProposal succeeds at 2-of-3"
else fail "ExecuteProposal: $out"; fi

out=$(ccQuery 1 "Governance:GetProposal" "$PROP")
echo "$out" | grep -q '"status":"EXECUTED"' && pass "GetProposal shows EXECUTED with its approval trail" \
  || fail "GetProposal: $out"

# --- 3. AccessControlRegistry ---------------------------------------------------
echo
echo "[3/7] AccessControlRegistry"
out=$(ccQuery 3 "AccessControlRegistry:HasActiveRole" "$ADMIN_ROLE" "$A_HASH")
[ "$out" = "true" ] && pass "HasActiveRole -> true after governed grant (queried from Org3)" \
  || fail "HasActiveRole: $out"

out=$(ccQuery 1 "AccessControlRegistry:GetRole" "$ADMIN_ROLE" "$A_HASH")
echo "$out" | grep -q '"granted":true' && pass "GetRole returns the grant record" || fail "GetRole: $out"

out=$(ccQuery 1 "AccessControlRegistry:GetStatusId" "$ADMIN_ROLE" "$A_HASH")
STATUS_ID="$out"
[ ${#STATUS_ID} -eq 64 ] && pass "GetStatusId returns a 32-byte hash" || fail "GetStatusId: $out"

out=$(ccQuery 1 "AccessControlRegistry:QueryRolesBySubject" "$A_HASH")
echo "$out" | grep -q "$ADMIN_ROLE" && pass "QueryRolesBySubject (CouchDB rich query)" || fail "QueryRolesBySubject: $out"

out=$(ccQuery 1 "AccessControlRegistry:QuerySubjectsByRole" "$ADMIN_ROLE")
echo "$out" | grep -q "$A_HASH" && pass "QuerySubjectsByRole (CouchDB rich query)" || fail "QuerySubjectsByRole: $out"

out=$(ccQuery 1 "AccessControlRegistry:HasActiveRole" "$ADMIN_ROLE" "$B_HASH")
[ "$out" = "false" ] && pass "HasActiveRole -> false for an identity never granted the role" \
  || fail "HasActiveRole(B): $out"

# NEGATIVE: expiry in the past must be refused (mirrors the Solidity require()).
out=$(ccInvoke 1 "Governance:ProposeAction" "GRANT_ROLE" \
      "{\"roleId\":\"$ADMIN_ROLE\",\"subject\":\"$B_HASH\",\"expiry\":\"$PAST\"}")
P2=$(ccQuery 1 "Governance:QueryPendingProposals" | "$NODE_BIN" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const p=JSON.parse(d);process.stdout.write(p[0]?p[0].proposalId:"");});')
ccInvoke 2 "Governance:ApproveProposal" "$P2" >/dev/null
out=$(ccInvoke 1 "Governance:ExecuteProposal" "$P2")
if echo "$out" | grep -q 'expiry must be in the future'; then
  pass "NEGATIVE: a grant with a past expiry is refused at execution"
else fail "NEGATIVE past-expiry not enforced: $out"; fi
ccInvoke 1 "Governance:CancelProposal" "$P2" >/dev/null 2>&1

# --- 4. RevocationRegistry ------------------------------------------------------
echo
echo "[4/7] RevocationRegistry"
out=$(ccQuery 1 "RevocationRegistry:IsRevoked" "$STATUS_ID")
[ "$out" = "false" ] && pass "IsRevoked -> false for a live grant" || fail "IsRevoked: $out"
out=$(ccQuery 1 "RevocationRegistry:IsExpired" "$STATUS_ID")
[ "$out" = "false" ] && pass "IsExpired -> false for a future expiry" || fail "IsExpired: $out"
out=$(ccQuery 1 "RevocationRegistry:GetStatus" "$STATUS_ID")
echo "$out" | grep -q "$STATUS_ID" && pass "GetStatus returns the status record" || fail "GetStatus: $out"

# --- 5. AssetNFT ----------------------------------------------------------------
echo
echo "[5/7] AssetNFT — governed mint and transfer"
ccInvoke 1 "Governance:ProposeAction" "MINT_ASSET" \
  "{\"owner\":\"$A_HASH\",\"ipfsCID\":\"QmTrustMeshTestAssetCID000000000000000000000000\",\"contentHash\":\"$(echo -n content | shasum -a 256 | cut -d' ' -f1)\"}" >/dev/null
PM=$(ccQuery 1 "Governance:QueryPendingProposals" | "$NODE_BIN" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const p=JSON.parse(d);process.stdout.write(p[0]?p[0].proposalId:"");});')
ccInvoke 2 "Governance:ApproveProposal" "$PM" >/dev/null
out=$(ccInvoke 1 "Governance:ExecuteProposal" "$PM")
echo "$out" | grep -q 'status:200' && pass "Governed MINT_ASSET executed at 2-of-3" || fail "MINT_ASSET: $out"

assets=$(ccQuery 1 "AssetNFT:QueryAssetsByOwner" "$A_HASH")
ASSET_ID=$(echo "$assets" | "$NODE_BIN" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const p=JSON.parse(d);process.stdout.write(p[0]?p[0].assetId:"");});')
[ -n "$ASSET_ID" ] && pass "QueryAssetsByOwner (CouchDB rich query) -> asset $ASSET_ID" \
  || fail "QueryAssetsByOwner: $assets"

out=$(ccQuery 1 "AssetNFT:GetAssetOwner" "$ASSET_ID")
[ "$out" = "$A_HASH" ] && pass "GetAssetOwner -> the minting recipient" || fail "GetAssetOwner: $out"
out=$(ccQuery 1 "AssetNFT:AssetExists" "$ASSET_ID")
[ "$out" = "true" ] && pass "AssetExists -> true" || fail "AssetExists: $out"
out=$(ccQuery 1 "AssetNFT:GetAsset" "$ASSET_ID")
echo "$out" | grep -q 'QmTrustMeshTestAssetCID' && pass "GetAsset returns CID and content hash" || fail "GetAsset: $out"

ccInvoke 1 "Governance:ProposeAction" "TRANSFER_ASSET" \
  "{\"assetId\":\"$ASSET_ID\",\"from\":\"$A_HASH\",\"to\":\"$B_HASH\"}" >/dev/null
PT=$(ccQuery 1 "Governance:QueryPendingProposals" | "$NODE_BIN" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const p=JSON.parse(d);process.stdout.write(p[0]?p[0].proposalId:"");});')
ccInvoke 3 "Governance:ApproveProposal" "$PT" >/dev/null
out=$(ccInvoke 1 "Governance:ExecuteProposal" "$PT")
echo "$out" | grep -q 'status:200' && pass "Governed TRANSFER_ASSET executed (Org1 + Org3)" || fail "TRANSFER_ASSET: $out"

out=$(ccQuery 1 "AssetNFT:GetAssetOwner" "$ASSET_ID")
[ "$out" = "$B_HASH" ] && pass "GetAssetOwner reflects the new owner" || fail "owner after transfer: $out"

out=$(ccQuery 1 "AssetNFT:GetAssetHistory" "$ASSET_ID")
n=$(echo "$out" | "$NODE_BIN" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(String(JSON.parse(d).length)));')
[ "$n" -ge 2 ] && pass "GetAssetHistory shows $n custody entries (immutable provenance)" \
  || fail "GetAssetHistory: $out"

# --- 6. Governed revocation and controller update --------------------------------
echo
echo "[6/7] Governed REVOKE_ROLE, SET_CREDENTIAL_STATUS, UPDATE_CONTROLLER"
ccInvoke 1 "Governance:ProposeAction" "REVOKE_ROLE" \
  "{\"roleId\":\"$ADMIN_ROLE\",\"subject\":\"$A_HASH\"}" >/dev/null
PR=$(ccQuery 1 "Governance:QueryPendingProposals" | "$NODE_BIN" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const p=JSON.parse(d);process.stdout.write(p[0]?p[0].proposalId:"");});')
ccInvoke 2 "Governance:ApproveProposal" "$PR" >/dev/null
out=$(ccInvoke 1 "Governance:ExecuteProposal" "$PR")
echo "$out" | grep -q 'status:200' && pass "Governed REVOKE_ROLE executed" || fail "REVOKE_ROLE: $out"

out=$(ccQuery 1 "AccessControlRegistry:HasActiveRole" "$ADMIN_ROLE" "$A_HASH")
[ "$out" = "false" ] && pass "HasActiveRole -> false after revocation" || fail "HasActiveRole after revoke: $out"
out=$(ccQuery 1 "RevocationRegistry:IsRevoked" "$STATUS_ID")
[ "$out" = "true" ] && pass "IsRevoked -> true (registries stayed in step)" || fail "IsRevoked after revoke: $out"

VC_STATUS=$(echo -n "vc-status-test" | shasum -a 256 | cut -d' ' -f1)
ccInvoke 1 "Governance:ProposeAction" "SET_CREDENTIAL_STATUS" \
  "{\"statusId\":\"$VC_STATUS\",\"revoked\":\"true\"}" >/dev/null
PS=$(ccQuery 1 "Governance:QueryPendingProposals" | "$NODE_BIN" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const p=JSON.parse(d);process.stdout.write(p[0]?p[0].proposalId:"");});')
ccInvoke 2 "Governance:ApproveProposal" "$PS" >/dev/null
ccInvoke 1 "Governance:ExecuteProposal" "$PS" >/dev/null
out=$(ccQuery 1 "RevocationRegistry:IsRevoked" "$VC_STATUS")
[ "$out" = "true" ] && pass "Governed SET_CREDENTIAL_STATUS revoked a credential" || fail "SET_CREDENTIAL_STATUS: $out"

ROTATED=$("$NODE_BIN" fabric/tools/identity.js new)
R_PUB=$(jqf "$ROTATED" publicKeyB64)
ccInvoke 1 "Governance:ProposeAction" "UPDATE_CONTROLLER" \
  "{\"didHash\":\"$A_HASH\",\"newControllerPublicKey\":\"$R_PUB\"}" >/dev/null
PU=$(ccQuery 1 "Governance:QueryPendingProposals" | "$NODE_BIN" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const p=JSON.parse(d);process.stdout.write(p[0]?p[0].proposalId:"");});')
ccInvoke 2 "Governance:ApproveProposal" "$PU" >/dev/null
ccInvoke 1 "Governance:ExecuteProposal" "$PU" >/dev/null
out=$(ccQuery 1 "DIDRegistry:GetController" "$A_HASH")
[ "$out" = "$R_PUB" ] && pass "Governed UPDATE_CONTROLLER re-bound the DID to a new key (key rotation / recovery)" \
  || fail "UPDATE_CONTROLLER: $out"

# --- 7. Endorsement policy negative test ------------------------------------------
echo
echo "[7/7] Endorsement policy"
if [ "$MODE" = "multi" ]; then
  # THE test §9 insists on: a write endorsed by only ONE org must be rejected by
  # the platform, not merely discouraged. We submit a real state change gathering
  # endorsement from Org1 alone, against a policy demanding 2 of 3.
  setOrg 1
  before=$(ccQuery 1 "DIDRegistry:DIDExists" "$B_HASH")
  C=$("$NODE_BIN" fabric/tools/identity.js new)
  C_DID=$(jqf "$C" did); C_HASH=$(jqf "$C" didHash)
  C_PUB=$(jqf "$C" publicKeyB64); C_SIG=$(jqf "$C" signatureB64)

  out=$(peer chaincode invoke "${ORDERER_ARGS[@]}" -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" \
        --peerAddresses "$PEER0_ORG1_ADDRESS" --tlsRootCertFiles "$PEER0_ORG1_CA" \
        --waitForEvent \
        -c "{\"Args\":[\"DIDRegistry:RegisterDID\",\"$C_DID\",\"$C_PUB\",\"$C_SIG\"]}" 2>&1)

  if echo "$out" | grep -qi 'ENDORSEMENT_POLICY_FAILURE'; then
    pass "NEGATIVE: single-org endorsement REJECTED with ENDORSEMENT_POLICY_FAILURE"
  else
    fail "NEGATIVE: single-org write was not rejected as expected: $out"
  fi

  # The decisive part -- the rejected transaction must have changed nothing.
  after=$(ccQuery 2 "DIDRegistry:DIDExists" "$C_HASH")
  if [ "$after" = "false" ]; then
    pass "NEGATIVE: ledger genuinely unchanged by the rejected transaction"
  else
    fail "NEGATIVE: rejected transaction still mutated state (DIDExists=$after)"
  fi

  # ... and the same write succeeds once a second org endorses it.
  out=$(peer chaincode invoke "${ORDERER_ARGS[@]}" -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" \
        --peerAddresses "$PEER0_ORG1_ADDRESS" --tlsRootCertFiles "$PEER0_ORG1_CA" \
        --peerAddresses "$PEER0_ORG3_ADDRESS" --tlsRootCertFiles "$PEER0_ORG3_CA" \
        --waitForEvent \
        -c "{\"Args\":[\"DIDRegistry:RegisterDID\",\"$C_DID\",\"$C_PUB\",\"$C_SIG\"]}" 2>&1)
  after2=$(ccQuery 2 "DIDRegistry:DIDExists" "$C_HASH")
  if [ "$after2" = "true" ]; then
    pass "the identical write SUCCEEDS with 2 orgs endorsing — policy discriminates, not just blocks"
  else
    fail "two-org endorsement did not succeed: $out"
  fi
else
  pass "(single-org policy mode — multi-org negative test runs in 'multi' mode)"
fi

echo
echo "──────────────────────────────────────────"
printf 'passed: %d   failed: %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
printf '\033[0;32mChaincode verified.\033[0m\n'
