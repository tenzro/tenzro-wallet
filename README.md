# Tenzro Wallet

**One wallet for AI agents, payments, and on-chain assets across every chain that matters.**

Tenzro Wallet is the official wallet for [Tenzro Network](https://tenzro.com) — an AI-native blockchain that runs Ethereum smart contracts, Solana programs, Canton's regulated-finance ledger, and its own native VM under one roof. This wallet is how a person, an app, or an autonomous agent holds money and identity across all of them at once.

## Why it exists

If you've held crypto before, you know the drill: one wallet for Ethereum, another for Solana, a third for the chain you bridged to last week, a recovery phrase you're scared to lose, and a different signing flow every time. Agents make it worse — every autonomous workflow needs its own keys, its own gas, its own spending limits.

Tenzro Wallet collapses that into:

- **One identity, four chains.** Your Tenzro identity (a [DID](https://www.w3.org/TR/did-1.0/)) controls native TNZO, EVM contracts, Solana programs, and Canton/DAML assets at the same time. Move TNZO between an Ethereum-compatible app and a Solana-style app on Tenzro and it's a pointer op, not a bridge — no waiting, no risk of stuck funds.
- **No seed phrase to lose.** Custody is split between a passkey on your device (Touch ID, Face ID, Windows Hello, a hardware security key) and a co-signer running in a trusted execution environment on the Tenzro network. Lose your phone? Recover with email, social delegates, or KYC re-attestation. No twelve-word backup card.
- **Post-quantum from day one.** Every transaction is signed twice — classical Ed25519 *and* ML-DSA-65, the post-quantum standard NIST finalised in [FIPS 204](https://csrc.nist.gov/pubs/fips/204/final). Your signatures stay valid the day a quantum computer breaks the old ones.
- **Built for agents, not just humans.** First-class support for [AP2](https://github.com/google/agent-payments-protocol) (Google), x402 (Coinbase), Visa TAP, Mastercard Agent Pay, OpenAI ACP, and ERC-8004 trustless agent identity. Set spending limits per agent. Stream micropayments per inference call. Revoke a compromised agent without rotating your main keys.
- **Capital markets and multi-party workflows.** Sign Capital Intents (the capital-markets analog of an AP2 mandate) for regulated tokenized assets. Drive saga workflows — Execute → Verify → Compensate → Settle — with optional per-step escrow, Canton DAML mirroring, and AP2 / x402 / MPP / Stripe SPT / Visa TAP / Mastercard Agent Pay mandate binding so every receipt threads back to the off-chain intent that authorized it.
- **EVM primitives, first-class.** EIP-7702 (Pectra Type-4) delegation lets an EOA temporarily delegate its code to a smart-contract address — the wallet derives the signing hash, signs it through the custody quorum, and decodes incoming delegation designators. Permit2 SignatureTransfer (with optional ERC-7683 witness binding) gives one-signature gasless flows. The Secure-Mint registry enforces a per-token 1:1 reserve-attestation invariant for tokenized real-world assets. ERC-7683 cross-chain intents surface origin orders and destination fill records.
- **Bridge to anywhere outside Tenzro.** Eight bridge vendors plug into one router — LI.FI, Chainlink CCIP, LayerZero, Wormhole, deBridge, Canton's HTLC escrow for regulated assets, Hyperlane V3 with Tenzro's sovereign validator-set ISM, and Axelar GMP for reach into Cosmos / Move / Stellar / XRPL chains. The router shows you all eight quotes; you pick.
- **Chain-agnostic discovery.** Every dApp connect and agent handshake returns CAIP-2 / CAIP-10 / CAIP-19 identifiers per the submitted `tenzro` CASA namespace, so consuming UIs never have to guess which chain or asset a balance belongs to.

## Who this is for

- **Builders** shipping multi-chain apps who don't want to ask users "which wallet?" every time.
- **Agent developers** who need scoped spending, revocable session keys, and a payment rail that works for both human-instructed and autonomous flows.
- **Institutions** moving regulated assets — Canton/DAML support means you can hold tokenised securities and stablecoin payments in the same wallet without moving custody between vendors.
- **End users** who want a wallet that doesn't feel like 1990s software — biometric auth, no seed phrases, recovery that actually works.

## What's in this repo

The wallet is built in layers so the same code runs in a browser extension, a hosted web wallet, a mobile app, and a service worker for agents. This repo ships:

- **`packages/wallet-kernel/`** — the engine. Pure TypeScript, no Node dependencies, runs anywhere a browser does. Handles identity, custody, signing across all four VMs, balance aggregation, route selection, agent payment policies, and the bridge router. **404 unit tests, live on testnet today.**
- **`apps/wallet/`** — the host scaffold. Wires the kernel into a real page: EIP-1193 provider on `window.tenzro`, EIP-6963 announcement so dApps discover it, device-provisioning UI for new wallets and recovery, and the seam where the WebAssembly FROST library plugs in.

The full architecture and design rationale lives in [`docs/DESIGN.md`](./docs/DESIGN.md).

## Architecture at a glance

```
                  ┌─────────────────────────────┐
                  │   one TDIP did:tenzro:…      │
                  │   passkey-quorum custody     │
                  └──────────────┬───────────────┘
                                 │
        ┌────────────┬───────────┼───────────┬────────────┐
        ▼            ▼           ▼           ▼            ▼
  Tenzro native  EVM-on-      SVM-on-     Canton/DAML   Bridge to
  (Ed25519,      Tenzro       Tenzro      MainNet       external
   18-dec)       (secp256k1,  (Ed25519,   (Canton       chains
                  18-dec)      9-dec)      external)
```

Cross-VM moves *on Tenzro* (the first three columns) are pointer ops through a precompile — instant, no bridge risk. Cross-chain moves *off Tenzro* (the last two columns) go through the bridge router. The kernel never picks a vendor for you; it surfaces all available quotes.

## Status

The kernel is testnet-functional today against the live Tenzro testnet at `rpc.tenzro.network`. Production readiness is **gated on M4b** (Canton MainNet surface, post-Splice 0.5.x baseline). See `docs/DESIGN.md §10` for the full milestone table.

| Milestone | What | State |
|---|---|---|
| M1 | Kernel skeleton, ports + adapters | Done |
| M2 | Tenzro native surface | Done — live on testnet |
| M3 | EVM + SVM on-Tenzro surfaces, cross-VM pointer ops | Done — live on testnet |
| M4a | Canton ports + adapters (design + interfaces) | Done |
| M4b | Canton MainNet surface | Gated on Splice 0.5.x baseline (post-2026-05-05) |
| M5 | Passkey-quorum custody (kernel pieces) | Done — FROST/ML-DSA/share-envelope HTTP adapters, WebAuthn PRF/largeBlob/escrow unwrapper, `walletNew()` / `walletRecover()` orchestrators |
| M5.5 | 2-of-3 pre-launch upgrade | Designed |
| M6 | `window.tenzro` injection (extension + web embed) | Kernel ready; `apps/wallet/` scaffolds the host-side wiring |
| M7 | Settlement (Visa TAP, Mastercard Agent Pay, x402, AP2) | x402 + AP2 + `payVisaTap` + `payMastercard` live on SDK; `signVisaTap` / `issueMastercardToken` issuance hooks SDK-pending |
| M8 | Bridge router (LI.FI, CCIP, LayerZero, Wormhole, deBridge, Canton) | Live on testnet — all six adapters wired against `client.bridge.{getRoutes,bridgeTokens}` |
| M9 | TDIP integration (delegate sets, recovery flows) | Kernel orchestrators shipped |

`pnpm test` runs **404 unit tests** across the kernel; four env-gated integration smokes exercise the live testnet end-to-end (1-wei native self-transfer, EVM `eth_*` reads, SVM views via the unified `tenzro_*` namespace, Canton validator reachability).

## Layout

```
docs/DESIGN.md                     # architecture + milestones (authoritative)
.env.example                       # integration-test env template

packages/
  wallet-kernel/                   # tenzro-wallet — the kernel
    src/
      kernel.ts                    # assembles surfaces, custody, ports, agent stack
      identity/                    # TDIP did:tenzro:, surface-key derivation,
                                   #   walletNew() / walletRecover() orchestrators
      custody/                     # passkey-quorum: FROST drivers, ML-DSA coordinator,
                                   #   passkey-share unwrapper, QR pairing
      consent/                     # policy engine + consent receipts
      balance/                     # cross-VM aggregator
      router/                      # intent → route decision
      surfaces/                    # tenzro-native, evm-on-tenzro, svm-on-tenzro,
                                   #   canton-internal, canton-external, canton-onboarding
      crypto/                      # eip1559 RLP, solana message compile, keccak256, base58
      settlement/                  # nanopayment-flow
      dapp/                        # EIP-6963 announcement + SDK browser-support re-exports
      ports/                       # external-system seams + adapters
        adapters/                  # tenzro-sdk-adapter, tenzro-identity-adapter
        agent/                     # agent ports: ap2, acp, erc8004, erc7802, htlc-escrow,
                                   #   nanopayment, lifecycle, principal-chain,
                                   #   fee-estimator, payment-rails, auth-approval,
                                   #   tee-attestation, escrow, insurance, agent-bond,
                                   #   session-key
        bridge/                    # eight vendor adapters (LI.FI / CCIP / LayerZero /
                                   #   Wormhole / deBridge / Canton / Hyperlane / Axelar)
                                   #   → one shared client.bridge
        canton/                    # ledger-api-adapter, http port, hash, fingerprint
        capital/                   # Capital Intents + reserve attestations + attested mints
        workflow/                  # multi-party saga workflows w/ Canton DAML mirroring
        eip7702/                   # Pectra Type-4 EOA delegation helpers
        permit2/                   # EIP-712 SignatureTransfer (with optional ERC-7683 witness)
        secure-mint/               # per-token 1:1 reserve-attestation invariant for RWAs
        hyperlane/                 # Hyperlane V3 with sovereign Tenzro-validator-set ISM
        axelar/                    # Axelar GMP (Cosmos / Move / Stellar / XRPL reach)
        erc7683/                   # cross-chain intents origin-side reads + fill records
        caip/                      # CAIP-2 / CAIP-10 / CAIP-19 chain-agnostic discovery
      integration/                 # env-gated smoke tests (skip without env)

apps/
  wallet/                          # @tenzro/wallet-app — host scaffold
    src/
      host/frost-wasm.ts           # FrostBackend seam (stub + production loader shape)
      dispatch/window-tenzro.ts    # KernelEip1193Provider + EIP-6963 announcement
      ui/onboarding.ts             # device-provisioning UI (drives walletNew/walletRecover)
      main.ts                      # load order + start function
```

## Install

```bash
pnpm install
pnpm typecheck    # whole repo
pnpm test         # whole repo (unit only — integration smokes skip without env)
pnpm lint         # biome
```

Toolchain: pnpm 10.33.2, Node ≥ 22, TypeScript 5.7.3, Vitest 2.1.9, Turborepo 2.3.3, Biome 1.9.4.

### Use it as a library

The wallet ships on npm as [`tenzro-wallet`](https://www.npmjs.com/package/tenzro-wallet) — browser-clean, ESM-only:

```bash
npm install tenzro-wallet tenzro-sdk
```

```typescript
import {
  WalletKernel,
  TenzroSdkAdapter,
  walletNew,
  buildEip6963Announcement,
} from 'tenzro-wallet';
import { TenzroClient, TESTNET_CONFIG } from 'tenzro-sdk';

// Build a wallet against the live testnet via the SDK adapter:
const sdkClient = new TenzroClient(TESTNET_CONFIG);
const tenzroPort = TenzroSdkAdapter.fromClient(sdkClient);
// … assemble surfaces + identity + agentPorts, then construct WalletKernel.
```

dApps that just want to *consume* an injected provider don't need `tenzro-wallet` — install `tenzro-sdk` and call `TenzroClient.fromInjected()`.

### Run the integration smokes

Smokes skip cleanly when their env vars are absent (so CI stays green). To run them, create a `.env` file in the repo root with the values you need:

```dotenv
# ─── Tenzro RPC ──────────────────────────────────────────────────────────────
# Base URL for the Tenzro JSON-RPC node (multi-VM ledger: native / EVM / SVM).
# Defaults to the public testnet; self-hosted nodes work too.
TENZRO_RPC_URL=https://rpc.tenzro.network

# DPoP-bound bearer JWT issued by Tenzro auth. Required by the native-VM
# `testnet.test.ts` smoke (the EVM/SVM smokes are read-only and don't need it).
# TENZRO_BEARER_JWT=replace-with-jwt

# An EVM-shaped address (0x… 20 bytes) you own on the network. Used by:
#   - `testnet.test.ts`        — 1-wei self-transfer (also needs the JWT)
#   - `evm-on-tenzro.test.ts`  — read-only EVM nonce/balance probes
#   - `svm-on-tenzro.test.ts`  — read-only SVM balance probe (pointer model
#                                 means one address covers both views)
# TENZRO_TEST_ADDRESS=0x0000000000000000000000000000000000000000

# Optional smoke-test timeout, ms.
# TENZRO_TEST_TIMEOUT_MS=60000

# ─── Canton MainNet validator ────────────────────────────────────────────────
# A Canton participant exposes two HTTP roots that share an Auth0 JWT
# (audience must equal `https://canton.network.global`). Operators of the
# Tenzro-run validator (or their own) supply the URLs through host config;
# they're intentionally omitted from this template to keep deployment-specific
# endpoints out of the repo.

# CANTON_LEDGER_BASE_URL=...        # JSON Ledger API root
# CANTON_VALIDATOR_BASE_URL=...     # Splice validator-app root
# CANTON_AUTH0_TOKEN=replace-with-jwt
# CANTON_USER_ID=replace-with-user-id
# CANTON_TEST_PARTY=replace-with-party-id
# CANTON_TEST_TIMEOUT_MS=30000
```

Nothing in `src/` reads these directly at runtime — host apps and tests pass values through the kernel's dep-injected ports. Keep secrets out of git.

## Architectural rules

These are load-bearing and described in detail in `docs/DESIGN.md §3` and `§4`:

1. **Ports + adapters.** Surfaces and the kernel only depend on port interfaces. The only files allowed to import `tenzro-sdk` are adapters under `src/ports/*/adapters/`. SDK shape changes break exactly one file.
2. **Four surfaces, one identity.** TDIP `did:tenzro:` is the root; each surface has a derived `SurfaceKey` (Ed25519 native, secp256k1 EVM, Ed25519 SVM, Canton external party).
3. **Cross-VM moves on Tenzro are pointer ops, not bridges.** Pointer ops flow through precompile `0x1003` / the `tenzro_cross_vm` SVM program. Tenzro↔Canton-MainNet and Tenzro↔external chains go through the bridge router. Don't conflate these in code or comments.
4. **Passkey-quorum custody is the default.** No seed phrases. Device share + node-TEE co-signer. M5 strategy: Ed25519 leg threshold-signed via FROST; ML-DSA-65 leg supplied by node TEE alone until threshold ML-DSA matures.
5. **Decimals are not interchangeable.** Native + EVM = 18 decimals; SVM = 9 decimals; Canton CC = `Numeric 10`. The router surfaces dust-truncation warnings; surfaces enforce per-view precision.
6. **Browser-clean kernel.** No `node:` imports, no `process.env` reads in `src/` outside `integration/`. Use Web Crypto, `fetch`, `TextEncoder`.

## Documentation

| Document | Purpose |
|----------|---------|
| [`docs/DESIGN.md`](docs/DESIGN.md) | Authoritative design: ports + adapters, kernel architecture, four VM surfaces, milestones |

## Contributing

Before opening a PR:

```bash
pnpm typecheck && pnpm test && pnpm lint
```

Tests are co-located with source (`*.test.ts` next to `*.ts`); integration smokes live under `src/integration/`. Keep adapters narrow — if the SDK shape changes, exactly one file should break.

## License

Apache-2.0. See [LICENSE](./LICENSE).
