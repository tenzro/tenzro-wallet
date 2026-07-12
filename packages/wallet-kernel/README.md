# tenzro-wallet

[![npm](https://img.shields.io/npm/v/tenzro-wallet)](https://www.npmjs.com/package/tenzro-wallet)
[![License](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)

The official wallet for [Tenzro Network](https://tenzro.com) — a browser-clean, ESM-only TypeScript engine you embed in your own host (extension, web app, mobile WebView, agent service worker). One identity, four VM surfaces, post-quantum signed, agent-aware.

- **TDIP `did:tenzro:`** — one identity controls native TNZO, EVM contracts, Solana programs, and Canton/DAML assets at the same time.
- **Passkey-quorum custody** — no seed phrases. Device share + node-TEE co-signer, FROST-signed Ed25519 + ML-DSA-65 (FIPS 204) post-quantum leg.
- **Cross-VM moves on Tenzro are pointer ops, not bridges.** Native ↔ EVM ↔ SVM go through precompile `0x1003` / the `tenzro_cross_vm` SVM program — instant, no bridge risk.
- **First-class Canton / DAML support.** Three surfaces for regulated-finance flows (`cantonInternalSurface` for single-party flows, `cantonExternalSurface` for multi-party flows across synchronizers, `cantonOnboardingSurface` for external-party onboarding) backed by `CantonValidatorPort` + `CantonIdentityPort` + `LedgerApiAdapter` (Canton JSON Ledger API v2). The kernel signs Canton `prepare` / `execute` submissions through its passkey-quorum custody — it **always signs locally**, never delegating signing to a node. Before signing it (1) recomputes the prepared-transaction hash and constant-time-compares it to the node's, then (2) **content-verifies** the decoded `PreparedTransaction` against the caller's intent — `actAs` authorization, transfer amount (Numeric→base-units normalized), and recipient presence — failing closed on any mismatch or undecodable field, so a tampered or mis-described transaction can never be signed. The same self-custody path runs in **two provider modes** via `resolveCantonAdapterConfig`: **BYO Canton node** (your own participant; auth is your Canton JWT as `Authorization: Bearer` or, for a differing token issuer, the `X-Canton-Auth: Bearer` escape hatch) and **Tenzro-network-provided Canton** (a Tenzro node fronts the participant; auth is a `tnz_…` API key in `X-Tenzro-Api-Key` and the node server-mints the tenant's Canton JWT — the wallet never holds it). Every Canton flow surfaces alongside EVM / SVM / native flows in the same router.
- **Agent payments built-in** — AP2 (Google), x402 (Coinbase), Visa TAP, Mastercard Agent Pay, OpenAI ACP, ERC-8004 trustless agent identity, ERC-7802 cross-chain mint/burn.
- **Capital markets + multi-party workflows** — Capital Intents (open / quote / assign / execute / verify / compensate / settle), reserve attestations + attested mints, saga workflows with AP2 / x402 / MPP / Stripe SPT / Visa TAP / Mastercard Agent Pay mandate binding.
- **EVM primitives, first-class** — EIP-7702 (Pectra Type-4) delegation, Permit2 SignatureTransfer with optional ERC-7683-witness binding, Secure-Mint registry (1:1 reserve invariant for tokenized RWAs), ERC-7683 cross-chain intents with optional `BridgeFeeHint` so one signed order is fungible across the 6 supported bridges.
- **Bridge fee in TNZO + Chainlink-backed oracle.** `BridgeFeeAdapter` lets the wallet quote destination-native bridge fees in TNZO, surface per-adapter sponsorship-pool state, sponsor a previously-quoted envelope, and read the caller's own Compute Unit consumption + per-method counters. The operator's node enables a live Chainlink-backed oracle when configured; otherwise quotes fall back to the governance-set rate table. Admin-only paths (rate registration, refill-threshold tuning, cross-tenant analytics) gated by `X-Tenzro-Admin-Token`.
- **Compliance + identity primitives.** `UrwaAdapter` (ERC-7943 uRWA kill-switch + frozen-tokens reads for the signing UI; admin-token-gated mutations), `Ivms101Adapter` (FATF Travel Rule IVMS101 v1.1.0 envelope canonical-hash binding), `AttestedClockAdapter` (TEE-attested timestamp envelope for saga step deadlines + AP2 mandate validity windows + parametric-insurance trigger windows), `SignedAgentCardAdapter` (A2A v1.0 SignedAgentCard canonical-hash for issuer-signed agent cards), `WormholeNttAdapter` (NTT chain catalog + transceiver registry).
- **Eight-vendor bridge router** — LI.FI, Chainlink CCIP, LayerZero V2, Wormhole, deBridge, Canton HTLC, Hyperlane V3 (sovereign Tenzro-ISM), Axelar GMP (Cosmos / Move / Stellar / XRPL). The kernel never picks a vendor for you; it surfaces all available quotes.
- **Chain-agnostic discovery (CAIP)** — CAIP-2 / CAIP-10 / CAIP-19 per the submitted `tenzro` CASA namespace (`ChainAgnostic/namespaces#184`), so every dApp connect + agent handshake returns unambiguous chain + account + asset labels.
- **Babylon BTC-secured staking, surfaced.** Read-side surface for staking dashboards (list finality providers, sum BTC delegations, list delegations) plus validator-operator write paths so a validator host can use the wallet kernel as the EOTS signing surface.
- **Tenzro Train protocol port (Phase 4 Confidential-tier).** Read + write surface for the distributed-training protocol layer — inspect runs and sealed receipts, sign training task posts, enroll the wallet's identity as a trainer DID (with `ConfidentialEnrollment` carrying the TEE attestation that binds to the sealed-shard manifest), submit outer gradients, install sealed-shard manifests. Read-only mode is available for monitoring agents that should never mutate state.

## Install

```bash
npm install tenzro-wallet tenzro-sdk
```

Peer-style dependency: `tenzro-wallet` imports `tenzro-sdk` for RPC + types. Pin both together.

## Quick start

```typescript
import {
  WalletKernel,
  TenzroSdkAdapter,
  walletNew,
  buildEip6963Announcement,
} from 'tenzro-wallet';
import { TenzroClient, TESTNET_CONFIG } from 'tenzro-sdk';

// 1. Build the SDK adapter (the only file allowed to import tenzro-sdk).
const sdkClient = new TenzroClient(TESTNET_CONFIG);
const tenzroPort = TenzroSdkAdapter.fromClient(sdkClient);

// 2. Provision a new wallet — passkey-quorum custody, post-quantum signed.
const wallet = await walletNew({
  // … host-supplied custody, identity, and policy ports
});

// 3. Assemble the kernel and announce on EIP-6963 so dApps discover it.
const kernel = new WalletKernel({ tenzro: tenzroPort, /* … */ });
const announcement = buildEip6963Announcement(kernel);
window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
  detail: announcement,
}));
```

## Architecture

```
                  ┌─────────────────────────────┐
                  │   one TDIP did:tenzro:…     │
                  │   passkey-quorum custody    │
                  └──────────────┬──────────────┘
                                 │
        ┌────────────┬───────────┼───────────┬────────────┐
        ▼            ▼           ▼           ▼            ▼
  Tenzro native  EVM-on-     SVM-on-      Canton/DAML   Bridge to
  (Ed25519,     Tenzro       Tenzro       MainNet       external
   18-dec)      (secp256k1,  (Ed25519,    (Canton       chains
                 18-dec)      9-dec)       external)
```

Built on a strict **ports + adapters** pattern:

- Wallet core and surfaces only depend on port interfaces.
- The only files allowed to import `tenzro-sdk` live under `src/ports/*/adapters/`.
- SDK shape changes break exactly one file.

Six independent VM surfaces — Tenzro native, EVM-on-Tenzro, SVM-on-Tenzro, Canton internal, Canton external, Canton onboarding — share one identity through TDIP-derived `SurfaceKey`s. The bridge router is a separate, parallel concern in `src/ports/bridge/` and currently covers eight external-chain vendors.

## Modules

| Export | Purpose |
|--------|---------|
| `WalletKernel` | Top-level facade — wires surfaces, custody, ports, agent stack. |
| `walletNew()` / `walletRecover()` | Identity orchestrators — provision a new wallet or recover an existing one through the configured custody quorum. |
| `TenzroSdkAdapter` | The one allowed `tenzro-sdk` import. Construct from a `TenzroClient` to feed `WalletKernel`. |
| `buildEip6963Announcement()` | Generate the EIP-6963 announcement payload for `window.tenzro` discovery. |
| `KernelEip1193Provider` | EIP-1193 `request(method, params)` provider built on top of a `WalletKernel`. |
| Custody drivers | `frostEd25519Driver`, `frostSecp256k1Driver`, `hybridEd25519MlDsaDriver`, `mlDsaCoordinator`, passkey-share unwrappers (PRF/largeBlob/escrow). |
| Agent ports | AP2, ACP, ERC-8004, ERC-7802, HTLC escrow, nanopayment channels, agent-bond, insurance, lifecycle, principal-chain, fee estimator, session-key, payment-rails (Visa/Mastercard/x402), TEE attestation. |
| Bridge adapters | `LiFiBridgeAdapter`, `CcipBridgeAdapter`, `LayerZeroBridgeAdapter`, `WormholeBridgeAdapter`, `DebridgeAdapter`, `CantonBridgeAdapter`, `HyperlaneAdapter`, `AxelarAdapter`. |
| Canton / DAML ports | `CantonValidatorPort` (Canton JSON Ledger API v2 — `prepareSubmission` / `executeSubmission` / completion stream / active-contracts queries), `CantonIdentityPort` (`TenzroSurfaceCantonParty`, hashing scheme version, signing scheme), `LedgerApiAdapter` (one adapter wrapping the Canton JSON Ledger API for both prepare + execute flows), `resolveCantonAdapterConfig` (dual-mode provider resolution: BYO-node vs Tenzro-network-provided — selects base URLs + per-request auth header builder), `verifyPreparedContent` + `CantonContentMismatchError` (fail-closed content check of the decoded `PreparedTransaction` against a `CantonTransferIntent` before signing), plus `preparedTransactionHash` / `topologyBundleHash` / `bytesEqualConstantTime` hash helpers in `ports/canton/hash.ts`. Used by all three Canton surfaces and by the `cantonBridgeAdapter` for Canton-HTLC cross-chain routes. |
| Capital + workflow ports | `CapitalIntentAdapter` (`open` / `quote` / `assign` / `execute` / `verify` / `compensate` / `settle` / `getIntent` + `submitReserveAttestation` / `getReserve` / `attestedMint`), `WorkflowAdapter` (`open` / `stepExecute` / `stepVerify` / `stepCompensate` / `finalize` / `getWorkflow` / `getSaga` / `getLifecycle` / `getReceipt` / `getOperationalMetrics` / `mirrorToCanton` / `verifyDidEnvelope` + listers). |
| EVM-primitive ports | `Eip7702Adapter` (signing hash + designator helpers), `Permit2Adapter` (`domainSeparator` / `digest` / `verifyAndConsume` / `nonceUsed` with optional ERC-7683-witness binding), `SecureMintAdapter` (per-token 1:1 reserve invariant for tokenized RWAs), `Erc7683Adapter` (origin-side reads + destination-side fill commits). |
| Discovery port | `CaipAdapter` — `caip2()` / `caip10(address)` / `caip19({ kind, token_id?, collection_id?, nft_token_id? })` per the submitted `tenzro` CASA namespace. |
| Shared-security port | `BabylonAdapter` — read surface for staking dashboards (`listFinalityProviders` / `totalStakeForProvider` / `listDelegations`) + validator-operator write paths (`registerFinalityProvider` / `submitFinalitySignature`) so a validator host can use the wallet kernel as the signing surface. |
| Distributed-training port | `TrainingAdapter(read[, write])` — read + write surface for the Tenzro Train protocol layer. Read methods inspect active runs, sealed receipts, and Confidential-tier sealed-shard manifests. Write methods (gated on a `TrainingClient`) post tasks, enroll trainers (with `ConfidentialEnrollment` for Phase 4 TEE-attested enrollment), submit outer gradients, finalize rounds, install sealed-shard manifests. |
| Bridge-fee + Chainlink port | `BridgeFeeAdapter` — cross-chain bridge fees in TNZO. `quote()` for destination-native fees, `listSponsorshipPools()` for per-adapter vault state, `sponsor()` against a previously-quoted envelope, `getAnalytics()` for subject self-read of CU consumption + per-method counters. Admin-only paths (`setRate()`, `setRefillThreshold()`, `listAnalytics()`) gated by `X-Tenzro-Admin-Token`. Read paths consult the operator's configured Chainlink-backed fee oracle when enabled; otherwise fall back to the governance-set rate table. Per-tenant rate-limiting + Compute Unit attribution applies — the read paths require a `chainlink`-scoped API key on the node. |
| Compliance + identity ports | `UrwaAdapter` (ERC-7943 — `isKillSwitched` / `getFrozenTokens` reads for the signing UI; admin-token-gated `setFrozenTokens` / `triggerKillSwitch` / `clearKillSwitch` mutations), `Ivms101Adapter` (FATF Travel Rule IVMS101 v1.1.0 envelope canonical-hash for cross-border transfer binding), `SignedAgentCardAdapter` (A2A v1.0 SignedAgentCard canonical-hash for issuer-signed agent cards), `AttestedClockAdapter` (TEE-attested timestamp envelope for saga step deadlines + obligation expiries + AP2 mandate validity windows + parametric-insurance trigger windows). |
| Wormhole NTT port | `WormholeNttAdapter` — Native Token Transfers chain catalog + multi-transceiver registry (Wormhole / Axelar / LayerZero / custom). Surfaces NTT chain reach so the signing UI shows which destination chains an NTT-deployed token can reach. |
| ERC-7683 `BridgeFeeHint` | Optional addition to `TenzroOrderData` that makes a single user-signed order fungible across the 6 supported bridges. The TNZO ceiling bounds the solver's destination-native fee commitment; the wallet UI surfaces the ceiling to the signer. |
| Surfaces | `tenzroNativeSurface`, `evmOnTenzroSurface`, `svmOnTenzroSurface`, `cantonInternalSurface`, `cantonExternalSurface`, `cantonOnboardingSurface`. |
| Router | `routeIntent()` — chooses the right surface (or bridge) for an intent and returns a typed plan. |
| Balance aggregator | `BalanceAggregator` — single-pass cross-surface balance read. |
| Consent engine | Policy + consent receipts (every privileged action returns a typed receipt). |

## Architectural rules

These are load-bearing and apply to every consumer that extends `tenzro-wallet`:

1. **Ports + adapters.** Surfaces and the kernel only depend on port interfaces. Only `src/ports/*/adapters/` may import `tenzro-sdk`.
2. **Four surfaces, one identity.** TDIP `did:tenzro:` is the root; each surface has a derived `SurfaceKey` (Ed25519 native, secp256k1 EVM, Ed25519 SVM, Canton external party).
3. **Cross-VM moves on Tenzro are pointer ops, not bridges.** Pointer ops flow through precompile `0x1003` / the `tenzro_cross_vm` SVM program. Tenzro↔Canton-MainNet and Tenzro↔external chains go through the bridge router.
4. **Passkey-quorum custody is the default.** No seed phrases. Device share + node-TEE co-signer. Ed25519 leg threshold-signed via FROST; ML-DSA-65 leg supplied by node TEE alone until threshold ML-DSA matures.
5. **Decimals are not interchangeable.** Native + EVM = 18; SVM = 9; Canton CC = `Numeric 10`. The router surfaces dust-truncation warnings.
6. **Browser-clean.** No `node:` imports, no `process.env` reads outside integration tests. Web Crypto, `fetch`, `TextEncoder` only.

## Status

Testnet-functional today against the live Tenzro testnet at `rpc.tenzro.xyz`.

| Milestone | What | State |
|---|---|---|
| M1 | Kernel skeleton, ports + adapters | Done |
| M2 | Tenzro native surface | Done — live on testnet |
| M3 | EVM + SVM on-Tenzro surfaces, cross-VM pointer ops | Done — live on testnet |
| M4a | Canton ports + adapters (`CantonValidatorPort`, `CantonIdentityPort`, `LedgerApiAdapter`, hash helpers, three surfaces) + sign-time content verification (`verifyPreparedContent`) + dual-mode provider (`resolveCantonAdapterConfig`: BYO-node / Tenzro-network-provided) | Done — shipped in dist; surfaces typecheck + unit-tested |
| M4b | Canton MainNet surface | Gated on Splice 0.5.x baseline (post-2026-05-05) |
| M5 | Passkey-quorum custody (kernel pieces) | Done |
| M5.5 | 2-of-3 pre-launch upgrade | Designed |
| M6 | `window.tenzro` injection (extension + web embed) | Kernel ready; host scaffolds in repo |
| M7 | Settlement (Visa TAP, Mastercard Agent Pay, x402) | Settle-side shipped (`payVisaTap`, `payMastercard`, `payX402`); issuance-side hooks declared, SDK-pending |
| M8 | Bridge router | Eight per-vendor adapters live (`lifi`, `ccip`, `layerzero`, `wormhole`, `debridge`, `canton`, `hyperlane`, `axelar`); SDK-shipped — all forward to the same `client.bridge` with `vendor:BridgeAdapterId` multiplexing |
| M9 | TDIP integration (delegate sets, recovery flows) | Kernel orchestrators shipped |
| M10 | Capital markets + workflows + EVM primitives + extended cross-chain reach + CAIP discovery | Ports + nine adapters shipped against `tenzro-sdk@^0.4.1` |
| M11 | Babylon Bitcoin staking + Tenzro Train protocol port (Phase 4 Confidential-tier) | Babylon port (read + validator-write surface) + Training port (`TrainingAdapter(read)` for monitoring, `TrainingAdapter(read, write)` for full custodial enrollment + sealed-shard manifest install) against `tenzro-sdk@^0.4.1` |
| M12 | Cross-chain bridge fee in TNZO + Chainlink-backed oracle + ERC-7683 `BridgeFeeHint` + ERC-7943 uRWA compliance + FATF IVMS101 + A2A SignedAgentCard + TEE-attested clock + Wormhole NTT | Six new ports + adapters (`BridgeFeeAdapter`, `UrwaAdapter`, `Ivms101Adapter`, `AttestedClockAdapter`, `SignedAgentCardAdapter`, `WormholeNttAdapter`) plus `BridgeFeeHint` on `Erc7683` against `tenzro-sdk@^0.4.7`. Per-tenant Compute Unit attribution + GCRA rate-limit on `chainlink`-scoped methods at the node layer. |

**426 unit tests** pass; 5 env-gated integration smokes exercise the live testnet end-to-end.

## Repository

The full monorepo (apps, browser extension, design docs) lives at [github.com/tenzro/tenzro-wallet](https://github.com/tenzro/tenzro-wallet). The authoritative architecture document is [`docs/DESIGN.md`](https://github.com/tenzro/tenzro-wallet/blob/main/docs/DESIGN.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
