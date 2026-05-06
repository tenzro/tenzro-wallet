# @tenzro/wallet-kernel

[![npm](https://img.shields.io/npm/v/@tenzro/wallet-kernel)](https://www.npmjs.com/package/@tenzro/wallet-kernel)
[![License](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)

The kernel of [Tenzro Wallet](https://github.com/tenzro/tenzro-wallet) — a browser-clean, ESM-only TypeScript engine that powers the official wallet for [Tenzro Network](https://tenzro.com). Use it directly to embed wallet behaviour in your own host (extension, web app, mobile WebView, agent service worker).

**One identity, four VM surfaces, post-quantum signed, agent-aware.**

- **TDIP `did:tenzro:`** — one identity controls native TNZO, EVM contracts, Solana programs, and Canton/DAML assets at the same time.
- **Passkey-quorum custody** — no seed phrases. Device share + node-TEE co-signer, FROST-signed Ed25519 + ML-DSA-65 (FIPS 204) post-quantum leg.
- **Cross-VM moves on Tenzro are pointer ops, not bridges.** Native ↔ EVM ↔ SVM go through precompile `0x1003` / the `tenzro_cross_vm` SVM program — instant, no bridge risk.
- **Agent payments built-in** — AP2 (Google), x402 (Coinbase), Visa TAP, Mastercard Agent Pay, OpenAI ACP, ERC-8004 trustless agent identity, ERC-7802 cross-chain mint/burn.
- **Six-vendor bridge router** — LI.FI, Chainlink CCIP, LayerZero V2, Wormhole, deBridge, Canton HTLC. The kernel never picks a vendor for you; it surfaces all available quotes.

## Install

```bash
npm install @tenzro/wallet-kernel tenzro-sdk
```

Peer-style dependency: the kernel imports `tenzro-sdk` for RPC + types. Pin both together.

## Quick start

```typescript
import {
  WalletKernel,
  TenzroSdkAdapter,
  walletNew,
  buildEip6963Announcement,
} from '@tenzro/wallet-kernel';
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

The kernel is built on a strict **ports + adapters** pattern:

- The kernel and surfaces only depend on port interfaces.
- The only files allowed to import `tenzro-sdk` live under `src/ports/*/adapters/`.
- SDK shape changes break exactly one file.

Six independent surfaces (Tenzro native, EVM-on-Tenzro, SVM-on-Tenzro, Canton internal, Canton external, Canton onboarding) share one identity through TDIP-derived `SurfaceKey`s.

## Modules

| Export | Purpose |
|--------|---------|
| `WalletKernel` | Top-level facade — wires surfaces, custody, ports, agent stack. |
| `walletNew()` / `walletRecover()` | Identity orchestrators — provision a new wallet or recover an existing one through the configured custody quorum. |
| `TenzroSdkAdapter` | The one allowed `tenzro-sdk` import. Construct from a `TenzroClient` to feed the kernel. |
| `buildEip6963Announcement()` | Generate the EIP-6963 announcement payload for `window.tenzro` discovery. |
| `KernelEip1193Provider` | EIP-1193 `request(method, params)` provider built on top of a `WalletKernel`. |
| Custody drivers | `frostEd25519Driver`, `frostSecp256k1Driver`, `hybridEd25519MlDsaDriver`, `mlDsaCoordinator`, passkey-share unwrappers (PRF/largeBlob/escrow). |
| Agent ports | AP2, ACP, ERC-8004, ERC-7802, HTLC escrow, nanopayment channels, agent-bond, insurance, lifecycle, principal-chain, fee estimator, session-key, payment-rails (Visa/Mastercard/x402), TEE attestation. |
| Bridge adapters | `LiFiBridgeAdapter`, `CcipBridgeAdapter`, `LayerZeroBridgeAdapter`, `WormholeBridgeAdapter`, `DebridgeAdapter`, `CantonBridgeAdapter`. |
| Surfaces | `tenzroNativeSurface`, `evmOnTenzroSurface`, `svmOnTenzroSurface`, `cantonInternalSurface`, `cantonExternalSurface`, `cantonOnboardingSurface`. |
| Router | `routeIntent()` — chooses the right surface (or bridge) for an intent and returns a typed plan. |
| Balance aggregator | `BalanceAggregator` — single-pass cross-surface balance read. |
| Consent engine | Policy + consent receipts (every privileged action returns a typed receipt). |

## Architectural rules

These are load-bearing and apply to every consumer that extends the kernel:

1. **Ports + adapters.** Surfaces and the kernel only depend on port interfaces. Only `src/ports/*/adapters/` may import `tenzro-sdk`.
2. **Four surfaces, one identity.** TDIP `did:tenzro:` is the root; each surface has a derived `SurfaceKey` (Ed25519 native, secp256k1 EVM, Ed25519 SVM, Canton external party).
3. **Cross-VM moves on Tenzro are pointer ops, not bridges.** Pointer ops flow through precompile `0x1003` / the `tenzro_cross_vm` SVM program. Tenzro↔Canton-MainNet and Tenzro↔external chains go through the bridge router.
4. **Passkey-quorum custody is the default.** No seed phrases. Device share + node-TEE co-signer. Ed25519 leg threshold-signed via FROST; ML-DSA-65 leg supplied by node TEE alone until threshold ML-DSA matures.
5. **Decimals are not interchangeable.** Native + EVM = 18; SVM = 9; Canton CC = `Numeric 10`. The router surfaces dust-truncation warnings.
6. **Browser-clean.** No `node:` imports, no `process.env` reads outside integration tests. Web Crypto, `fetch`, `TextEncoder` only.

## Status

The kernel is testnet-functional today against the live Tenzro testnet at `rpc.tenzro.network`.

| Milestone | What | State |
|---|---|---|
| M1 | Kernel skeleton, ports + adapters | Done |
| M2 | Tenzro native surface | Done — live on testnet |
| M3 | EVM + SVM on-Tenzro surfaces, cross-VM pointer ops | Done — live on testnet |
| M4a | Canton ports + adapters (design + interfaces) | Done |
| M4b | Canton MainNet surface | Gated on Splice 0.5.x baseline (post-2026-05-05) |
| M5 | Passkey-quorum custody (kernel pieces) | Done |
| M5.5 | 2-of-3 pre-launch upgrade | Designed |
| M6 | `window.tenzro` injection (extension + web embed) | Kernel ready; host scaffolds in repo |
| M7 | Settlement (Visa TAP, Mastercard Agent Pay, x402) | Ports declared, SDK-pending |
| M8 | Bridge router (six vendors) | Ports + six adapters shipped, SDK-pending |
| M9 | TDIP integration (delegate sets, recovery flows) | Kernel orchestrators shipped |

**395 unit tests** pass against the kernel; 4 env-gated integration smokes exercise the live testnet end-to-end.

## Repository

The full monorepo (apps, browser extension, design docs) lives at [github.com/tenzro/tenzro-wallet](https://github.com/tenzro/tenzro-wallet). The authoritative architecture document is [`docs/DESIGN.md`](https://github.com/tenzro/tenzro-wallet/blob/main/docs/DESIGN.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
