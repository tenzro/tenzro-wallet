#!/bin/bash
# One-command release of the wallet to wallet.tenzro.com. Run on server2 from the wallet tree.
# Refuses to run unless a public RPC answers for chain 13380 (0x3444): a build pointed at a dead
# endpoint must not replace the live site. Rolls back by itself if the live checks fail.
set -euo pipefail
RPC="${WALLET_RPC:-https://rpc.tenzro.com}"
LIVE=wallet.tenzro.com
cd "$(dirname "$0")/.."
chain=$(curl -sf -m 15 -X POST "$RPC" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | sed -n 's/.*"result":"\([^"]*\)".*/\1/p') || chain=""
[ "$chain" = "0x3444" ] || { echo "REFUSED: $RPC does not answer 0x3444 (got '${chain}'). Nothing deployed."; exit 2; }
before=$(ssh server1 'basename "$(readlink /var/lib/furcate/deploy/sites/wallet/current)"')
echo "live release before: $before"
NEXT_PUBLIC_WALLET_RP_ID=$LIVE NEXT_PUBLIC_WALLET_CHAIN_ID=13380 \
  NEXT_PUBLIC_WALLET_SEEDS="$RPC" pnpm --filter @tenzro/web build
pnpm --filter @tenzro/web test && pnpm --filter @tenzro/web typecheck && pnpm lint
dir=$(mktemp -d /tmp/wallet-release-XXXXXX)
rsync -a apps/web/out/ "$dir/"
ssh server1 "mkdir -p $dir" && rsync -a "$dir/" "server1:$dir/"
ssh server1 "furcatectl deploy $dir wallet $LIVE wallet.app.praecise.cloud"
if curl -sf --retry 5 --retry-delay 3 --retry-connrefused -m 20 "https://$LIVE/" | grep -q "<title>" && \
   curl -sf --retry 3 --retry-delay 3 -m 20 -o /dev/null -w '%{http_code}' "https://$LIVE/send" | grep -q 200; then
  echo "deployed; previous release for rollback: $before"
else
  echo "live checks failed; rolling back to $before"
  ssh server1 "furcatectl deploy rollback wallet $before"
  exit 1
fi
