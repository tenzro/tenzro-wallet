#!/usr/bin/env bash
# Builds the wallet for the end-to-end tests with TWO routes to the dev node.
#
# The wallet checks every approval against a second node before it signs
# (apps/web/lib/network.ts). A build with one route has no second node and
# refuses the approval, which fails the devices and recovery specs. A solo dev
# node is both routes: it is reached by two names, 127.0.0.1 (the seed) and
# localhost (the second RPC), which the browser treats as different origins.
#
#   WALLET_E2E_RPC     the node's JSON-RPC, default http://127.0.0.1:8545
#   WALLET_E2E_RPC2    the same node by its other name, default: WALLET_E2E_RPC
#                      with 127.0.0.1 replaced by localhost
#   WALLET_E2E_CHAIN   chain id, default 13380
set -euo pipefail
cd "$(dirname "$0")/../.."
rpc=${WALLET_E2E_RPC:-http://127.0.0.1:8545}
rpc2=${WALLET_E2E_RPC2:-${rpc/127.0.0.1/localhost}}
[[ $rpc != "$rpc2" ]] || { echo "build.sh: WALLET_E2E_RPC2 must name the node differently from WALLET_E2E_RPC ($rpc); set it" >&2; exit 2; }
NEXT_PUBLIC_WALLET_RP_ID=localhost \
NEXT_PUBLIC_WALLET_SEEDS="$rpc,$rpc2" \
NEXT_PUBLIC_WALLET_SECOND_RPC="$rpc2" \
NEXT_PUBLIC_WALLET_CHAIN_ID="${WALLET_E2E_CHAIN:-13380}" \
  pnpm --filter @tenzro/web build
# The extension spec loads extension/dist unpacked.
EXT_RPC="$rpc" EXT_CHAIN_ID="${WALLET_E2E_CHAIN:-13380}" EXT_WALLET_ORIGIN=http://localhost:4173 EXT_RP_ID=localhost \
EXT_EXTRA_HOSTS='http://localhost/*,http://127.0.0.1/*' \
  node extension/build.mjs
