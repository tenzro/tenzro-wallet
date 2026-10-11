# Tenzro Wallet

The open reference wallet for the Tenzro Network. Any wallet provider can
deploy it on its own domain: passkeys are created on that domain, each one
records its domain on chain, and no other provider is involved.

An account is a smart account whose keystore on chain lists the passkeys that
act for it. The wallet builds every change with the open SDK
([`tenzro-sdk`](https://github.com/tenzro/tenzro-sdk-typescript)); it holds
no key and runs no server of its own.

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

## Develop

```
apps/web/          the wallet (Next.js, static export)
  app/             pages: account, send, devices, recovery, recover, agents, requests, approve
  lib/             flows on the SDK, each with tests
packages/ui/       design system: components and tokens
```

`tenzro-sdk` 0.8 is linked from a checkout of
[tenzro-sdk-typescript](https://github.com/tenzro/tenzro-sdk-typescript)
beside this repository (`../tenzro-sdk-typescript`, built with
`npm ci && npx tsc -b`) until that version is on npm.

```bash
pnpm --filter @tenzro/web test        # unit tests
pnpm --filter @tenzro/web typecheck
pnpm lint
```

## License

Apache-2.0
