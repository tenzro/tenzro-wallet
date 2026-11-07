# Tenzro Wallet

The open reference wallet for the Tenzro Network. Any wallet provider can
deploy it on its own domain: passkeys are created on that domain, each one
records its domain on chain, and no other provider is involved.

An account is a smart account whose keystore on chain lists the passkeys that
act for it. The wallet builds every change with the open SDK
([`tenzro-sdk`](https://github.com/tenzro/tenzro-network/tree/main/sdk/tenzro-ts-sdk));
it holds no key and runs no server of its own. It is built for the Tenzro
Network, chain id `13380` (`0x3444`).

## What it does

- **One-tap account.** A passkey on this device creates the account. No seed
  phrase, nothing to write down.
- **A second root before balances grow.** Spending needs two independent
  passkeys; the wallet asks for a second device until there is one.
- **Devices.** Link a device with an invite and a request code (nothing
  secret moves between devices). A device linked while the account has fewer
  than two independent passkeys waits before it counts, and any other
  passkey can cancel it. Remove devices; optionally require two passkeys for
  everything.
- **Two passkeys for high-risk changes.** Once the account has two
  independent passkeys, removing a device, changing recovery or the policy
  needs both.
- **Guardians and a hardware key.** People you trust and hardware security
  keys you keep, with a threshold, can add a new passkey if every device is
  lost.
- **Optional one-time recovery code.** Off unless turned on. Generated in the
  browser; the account holds only a commitment. What you download is the code
  kit, never a key. Using it takes a claim sent by another account, then the
  code after a delay.
- **Recovery you can see.** Every open device shows a recovery in progress,
  its remaining wait, and a cancel button.
- **Approvals show what the network says.** Before a passkey signs a
  transaction, a node executes it on a copy of its state at a named block and
  a node of another operator does the same; the wallet shows the effects only
  when both agree, and nothing otherwise.
- **Agents.** Delegate an agent with limits per payment and per day, an
  allow-list of accounts and an expiry, approved by your passkey. The wallet
  signs only if the terms the node completes match what you approved.
- **Sites.** A site opens `/approve` as a popup to connect or to ask for a
  transaction; see [Sites](#sites).

Every wait (adding a device, recovery, the recovery code) is a governed
network parameter. The wallet reads the current values from chain state.

## Deploy your own

The wallet is a static site. Build it with your settings and serve `apps/web/out`.
The reference deployment is https://wallet.tenzro.com (chain id `13380`).

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_WALLET_RP_ID` | Your WebAuthn relying party: your domain. Defaults to the host serving the wallet. |
| `NEXT_PUBLIC_WALLET_NAME` | The name the wallet shows. |
| `NEXT_PUBLIC_WALLET_SEEDS` | Nodes to start from, comma-separated. Hints only: the wallet reads the RPC operators from chain state. Defaults to the SDK's seeds. |
| `NEXT_PUBLIC_WALLET_CHAIN_ID` | The chain every node must answer for. Defaults to the SDK's. |
| `NEXT_PUBLIC_WALLET_SECOND_RPC` | A node of another operator to cross-check effects. By default the wallet picks one from the network's list. |
| `NEXT_PUBLIC_WALLET_SPONSOR_URL` | Optional. Your sponsor, which pays the fee of a keystore change for an account that holds nothing yet: `POST { update }`, answering `{ tx_hash }`. It cannot change anything the passkeys did not approve. |

```bash
pnpm install
pnpm --filter @tenzro/ui build
NEXT_PUBLIC_WALLET_RP_ID=wallet.example pnpm --filter @tenzro/web build
```

To be listed as a staked wallet provider, serve
`/.well-known/tenzro-provider` and bond for your domain as the network guide
describes. The wallet works without it.

Serve these headers with the site (a static export cannot set them):

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000
```

`connect-src` must reach your seeds and the network's RPC operators; list
them instead of `https:` if you prefer.

## Sites

A site opens `https://<wallet>/approve` with `window.open`, waits for
`{ protocol: 'tenzro-wallet/popup/v1', type: 'ready' }`, then posts one
request at a time:

```js
{ protocol: 'tenzro-wallet/popup/v1', type: 'request', id, method, params }
```

| Method | Params | Result |
|---|---|---|
| `tenzro_connect` | none | `{ account, did }` |
| `tenzro_sendTransaction` | a typed transaction `{ kind, fields, to? }` | `{ tx_hash }` |
| `tenzro_disconnect` | none | `null` |

The wallet answers `{ protocol, type: 'response', id, result }` or
`{ ..., error: { code, message } }` to the requesting origin only. A site
never chooses the sending account, and every transaction is shown with its
node-derived effects before the passkey signs.

## Passkeys and the post-quantum key

An account's signatures carry two legs: the passkey's WebAuthn assertion
(P-256) and an ML-DSA-65 signature. A browser has no ML-DSA hardware, so the
wallet derives that key from the passkey itself with the WebAuthn **PRF
extension**: the authenticator answers a fixed salt with a secret only that
credential can produce, and the wallet derives the ML-DSA-65 key from it
(HKDF-SHA-256). Nothing is stored; every device holding the passkey (a synced
passkey included) derives the same key. A passkey or browser that cannot
answer the PRF cannot create an account here, and the wallet says so in plain words.

Supported: Chrome or Edge 116+, Safari 18+, Firefox 139+, with a platform passkey (Touch ID, Windows Hello, Android) or a FIDO2.1 security key that supports hmac-secret. The wallet reports the PRF answer; some passkey providers do not return it yet.

- **Relying party.** Passkeys are created on `NEXT_PUBLIC_WALLET_RP_ID` (the
  serving host by default; `wallet.tenzro.com` for the reference deployment).
  Each passkey records its relying party in the account's keystore. The
  network accepts an assertion whose origin is an `https://` page on that
  domain (or `localhost` for development).
- **An account is on chain after its first keystore change.** Until then the
  wallet keeps the passkey's public facts on the device; signing in on another
  device needs the account to have made one change, which takes a balance (or
  a sponsor).
- **Chain id.** `0.9` of the SDK binds the chain id into every keystore
  change digest and recovery-code claim. The wallet refuses endpoints that do
  not answer for `NEXT_PUBLIC_WALLET_CHAIN_ID` (default `13380`).
- **Browser extension.** `extension/` holds a Manifest V3 scaffold; read its
  README for what a Chrome extension can and cannot sign today.

## Develop

```
apps/web/          the wallet (Next.js, static export)
  app/             pages: account, send, devices, recovery, recover, agents, requests, approve
  lib/             flows on the SDK, each with tests
packages/ui/       design system: components and tokens
extension/         Manifest V3 extension scaffold
tests/e2e/         Playwright tests with a virtual authenticator
vendor/sdk/        the packed tenzro-sdk 0.9.0 (see below)
```

### The SDK

`tenzro-sdk` `0.9.0` is not on npm yet. It is built from
[`sdk/tenzro-ts-sdk`](https://github.com/tenzro/tenzro-network/tree/main/sdk/tenzro-ts-sdk)
in the Tenzro repository and packed into `vendor/sdk/` (the SDK and its
seven `@tenzro/*` packages as `.tgz`). `pnpm-workspace.yaml` points every one
of them at those files, so `pnpm-lock.yaml` records exactly what was built.
When 0.9.0 is published, delete `vendor/` and the `overrides` block and set
the version.

To refresh the packed SDK from a checkout of the Tenzro repository:

```bash
cd tenzro-network/sdk/tenzro-ts-sdk
npm ci && npx tsc -b
npm pack --pack-destination ../../../tenzro-wallet/vendor/sdk --workspaces .
npm pack --pack-destination ../../../tenzro-wallet/vendor/sdk
```

### Run, test, build

```bash
pnpm install
pnpm --filter @tenzro/ui build
pnpm --filter @tenzro/web test        # unit tests
pnpm --filter @tenzro/web typecheck
pnpm lint
NEXT_PUBLIC_WALLET_RP_ID=localhost pnpm --filter @tenzro/web dev
```

### End-to-end tests

The tests in `tests/e2e` drive the built wallet in Chromium with a CDP
virtual authenticator (CTAP2, internal, resident keys, user verification,
PRF) against a Tenzro node you run. A solo node on the launch genesis is
enough; it makes a block only when a transaction arrives, and has no faucet,
so give the tests a command that funds an address.

```bash
export WALLET_E2E_RPC=http://127.0.0.1:8545      # the node's JSON-RPC
export WALLET_E2E_FUND="ssh node-host /path/fund.sh"   # <address> <TNZO>
tests/e2e/build.sh          # two routes to the node: seeds 127.0.0.1 and localhost
pnpm exec playwright test -c tests/e2e/playwright.config.ts
```

The build has two routes to the node because the wallet checks every approval
against a second node before it signs. With one route there is no second node
and the devices and recovery specs refuse the approval. A solo node is both
routes under its two names; the node's `cors_allowed_origins` covers both.

The node must list the test origin in `cors_allowed_origins`
(`http://localhost:4173`). Set `CHROMIUM` to a Chromium binary if
Playwright's own is not installed.

## License

Apache-2.0
