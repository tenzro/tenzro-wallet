# Tenzro Wallet — Design

> Status: design draft, 2026-04-30
> Author: hilal@tenzro.com
> Scope: a single wallet that gives users full use of the Tenzro Ledger and Network and unified access to four execution surfaces — the Tenzro native VM, EVM, SVM, and Canton/DAML — with one identity, one balance view, and one consent surface.

---

## 1. What we are building, and why it has to exist

Tenzro Ledger is unusual: it runs **EVM, SVM, and DAML in a single runtime** with a Sei-V2-style native-balance pointer model, so a TNZO transfer on the EVM side is *immediately* visible on the SVM and Canton sides — there is no bridge between them, only three views over one balance ([Tenzro multi-VM docs](https://tenzro.com/docs/multi-vm), [cross-VM tokens](https://tenzro.com/docs/cross-vm-tokens)). On top of that, Tenzro is the AI-economy settlement layer: agents pay each other via MPP/x402/AP2/Tempo, settle through escrow and nanopayment channels, and authenticate as TDIP DIDs ([architecture](https://tenzro.com/docs/architecture), [payments](https://tenzro.com/docs/payments)).

External Canton Network MainNet is a *separate* ledger that we already participate in — Tenzro operates a non-SV validator on it. That validator is the natural Canton on-ramp for Tenzro users. (Operational details — endpoints, infra, contact-id holdings — are tracked in a private operations document.)

Today, a user who wants to do all of this needs three or four wallets: MetaMask for EVM, Phantom/Solflare for SVM, a Canton wallet (Splice wallet UI, Loop, Dfns, Fireblocks-Canton) for CC and Canton tokens, plus a TNZO wallet for native Tenzro operations. Each has its own seed, its own UX, its own consent flow, and none of them know about the others. That defeats the entire premise of Tenzro's unified runtime.

**Tenzro Wallet's job is to collapse those into one.** One identity (TDIP DID), one custody primitive (MPC 2-of-3), one consent UI, one balance view, one transaction history — across four execution surfaces and across cross-chain destinations.

---

## 2. The four surfaces, named precisely

| Surface | What it is | Address/identity primitive | Native asset accounting |
|---|---|---|---|
| **Tenzro native** | Native VM on Tenzro Ledger — the canonical TNZO balance, escrow primitive, settlement engine | TDIP DID + Ed25519 pubkey | TNZO (canonical units) |
| **EVM-on-Tenzro** | revm inside Tenzro runtime; sees TNZO as `wTNZO` ERC-20 at `0x7a4bcb13a6b2b384c284b5caa6e5ef3126527f93`; ERC-4337 paymaster works here | secp256k1 / 20-byte addr | wTNZO (18 dec) |
| **SVM-on-Tenzro** | solana_rbpf inside Tenzro runtime; SPL Token Adapter view of TNZO | Ed25519 pubkey (Solana-shape) | TNZO via SPL adapter (9 dec, sub-lamport truncation) |
| **Canton (DAML)** | Two distinct things share this name. **(a)** Canton/DAML execution *inside* the Tenzro runtime — TNZO as a CIP-56 holding template, reached via CantonAdapter. **(b)** Canton Network MainNet — *external* ledger holding CC and other CIP-56 tokens; reached via Splice Wallet Kernel + a validator's Ledger API. | External Canton party id (Ed25519-keyed), e.g. `kraken::1220dd08…` | CIP-56 holdings (UTXO-style) |

The wallet must treat (4a) and (4b) as **two different ledgers** that happen to speak the same language. Cross-VM moves on Tenzro between EVM, SVM, and DAML-in-Tenzro are *pointer ops* (precompile `0x1003`). Moves between Tenzro and Canton MainNet are *bridge ops* (CantonAdapter, real settlement, real fees).

---

## 3. Design principles

1. **One identity, four addresses.** TDIP `did:tenzro:human:{uuid}` is the root. Per-surface keys/addresses are *deterministic projections* of the root, derived inside the MPC quorum. The user never sees four seed phrases.
2. **Pointers are not bridges.** Within Tenzro Ledger, "send TNZO from EVM to SVM" is a balance-view change, not a value transfer. The UI must not call it a bridge, must not charge a bridge fee, and must not show a confirmation modal that implies risk. Bridge UX is reserved for moves that *cross* ledgers (to Canton MainNet, to external Ethereum/Solana).
3. **Passkey-quorum custody, no seed phrases.** A Tenzro identity is held by a 2-of-2 threshold quorum: one *passkey-bound device share* on a user device (phone, laptop, tablet, hardware key), unlockable only through the platform passkey on that device (Apple Passkeys / Google Passkeys / WebAuthn / FIDO2), plus one share in the Tenzro node TEE. Both signatures are required for every transaction; neither side can sign alone. There is no seed phrase. Recovery is "prove identity, get a new device share dealt by the TEE." This is the **Tenzro-native custody model** for testnet and pre-launch, governed by the network and exposed by every Tenzro RPC node; the quorum extends to 2-of-3 (device + paired device + TEE) before MainNet launch. See §4.3.
4. **Hybrid signing on Tenzro native.** Ed25519 + ML-DSA-65 on Tenzro txs ([wallet-sdk](https://tenzro.com/docs/wallet-sdk)). Pure Ed25519 on Canton, pure secp256k1 on EVM, pure Ed25519 on SVM. The wallet picks per surface; the user does not.
5. **Capabilities, not raw signing.** All app-facing access is scoped: session keys with per-tx caps, daily limits, contract whitelists, time windows. AP2 and Mastercard Agent Pay tokens layer on top of this, with the rule that the *effective limit is the intersection of the agent's identity-level delegation and the per-session policy*.
6. **Consent is one screen.** A single confirmation flow describes what is happening in human terms ("send 10 USDC to alice.tenzro on Solana side; arrives in <1s, no bridge fee") regardless of which surface is involved.
7. **Greenfield-first, additively compatible.** We ship a Tenzro-native wallet first; we are not reskinning MetaMask or Phantom. We will *expose* EIP-1193 and Solana wallet-adapter shims so dApps written for those ecosystems can talk to us, but that is a compatibility layer, not the core API. The core dApp API is **CIP-103 / `window.canton` style** ([Splice Wallet Kernel](https://github.com/hyperledger-labs/splice-wallet-kernel)) extended with Tenzro methods.

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Tenzro Wallet (client)                            │
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │  Web UI    │  │ Desktop    │  │ Mobile      │  │ Browser ext      │  │
│  │ (Next.js)  │  │ (Tauri)    │  │ (RN)        │  │ (window.canton + │  │
│  │            │  │            │  │             │  │  EIP-1193 shim)  │  │
│  └─────┬──────┘  └─────┬──────┘  └─────┬───────┘  └────────┬─────────┘  │
│        └────────────────┴───────────────┴───────────────────┘            │
│                                  │                                       │
│                ┌─────────────────▼───────────────────┐                   │
│                │   Wallet Kernel (TS, shared core)    │                  │
│                │  ┌─────────────────────────────────┐ │                  │
│                │  │  Identity (TDIP)                │ │                  │
│                │  │  Custody (passkey-quorum 2-of-N) │ │                 │
│                │  │  Consent / Session policy       │ │                  │
│                │  │  Balance aggregator             │ │                  │
│                │  │  Tx router (per-surface)        │ │                  │
│                │  │  Settlement client (escrow,     │ │                  │
│                │  │     channels, x402, MPP, AP2)   │ │                  │
│                │  │  Bridge router (LI.FI/CCIP/...) │ │                  │
│                │  └─────────────────────────────────┘ │                  │
│                └────┬─────────────┬─────────────┬─────┘                  │
└─────────────────────┼─────────────┼─────────────┼────────────────────────┘
                      │             │             │
              ┌───────▼─────┐ ┌─────▼─────────┐ ┌────▼──────────────────────┐
              │ Tenzro RPC  │ │ Pairing /     │ │ Canton MainNet validator  │
              │ (JSON-RPC + │ │ sign page     │ │  Splice Wallet Kernel     │
              │  REST,      │ │ (hosted on    │ │  → validator-app :5003    │
              │  hosts /    │ │  every RPC    │ │  → participant LAPI :7575 │
              │  wallet/*)  │ │  node, TEE    │ │                           │
              │             │ │  share lives  │ │                           │
              │             │ │  here)        │ │                           │
              └─────────────┘ └───────────────┘ └───────────────────────────┘
                      │
              ┌───────┴────────┐
              │ MultiVmRuntime │
              │ EVM / SVM /    │
              │ DAML / Native  │
              └────────────────┘
```

### 4.1 The kernel is one process, the surfaces are policies

We deliberately do **not** ship four mini-wallets glued together. There is one wallet kernel; it owns identity, custody, consent, and policy. Surfaces are *modules* — pure functions that translate user intent into the surface-appropriate transaction shape:

- `surfaces/tenzroNative.ts` — builds Native VM txs, hybrid Ed25519+ML-DSA-65 sign
- `surfaces/evm.ts` — builds EIP-1559 / 4337 UserOps; secp256k1 sign
- `surfaces/svm.ts` — builds Solana txs/instructions; Ed25519 sign
- `surfaces/cantonInternal.ts` — Canton-on-Tenzro via CantonAdapter
- `surfaces/cantonExternal.ts` — Canton MainNet via Splice Wallet SDK

Each surface module exports the same interface: `prepare(intent) → preview`, `sign(prepared)`, `submit(signed)`, `status(handle)`. The kernel routes based on `intent.surface` (set explicitly by the dApp via CIP-103, or inferred by the kernel from token + destination).

### 4.2 Identity: TDIP as the root, surfaces as projections

A new user gets:
1. A `did:tenzro:human:{uuid}` ([identity](https://tenzro.com/docs/identity)).
2. A **2-of-2 passkey-quorum** custody record: one paired device (phone or laptop) holding a passkey-bound share, plus the Tenzro node TEE holding the second share. Both signatures are required for every transaction. Pre-launch (before MainNet), this extends to 2-of-3 with a second user device; for testnet we ship 2-of-2.
3. Per-surface key material derived deterministically inside the quorum:
   - **Tenzro native:** Ed25519 (root)
   - **EVM:** secp256k1, derived path `m/tenzro/evm/0`
   - **SVM:** Ed25519, derived path `m/tenzro/svm/0`
   - **Canton (internal):** Ed25519 → Canton external party id materialized at first use via `ExternalPartySetupProposal`
   - **Canton (external MainNet):** *separately* allocated Ed25519 + party id; can be the same key as internal if the user opts in, but defaults to a distinct key so MainNet exposure is opt-in.

The DID Document (W3C-compatible) lists each derived key under `verificationMethod` with a `tenzro:surface` field. Anyone resolving the DID sees one identity with four cryptographic personas — including dApps that need to know "what's this user's EVM address?" without a separate handshake.

### 4.3 Custody: passkey-quorum, the Tenzro-native model

Tenzro Wallet does not use seed phrases, hardware wallets, or password-encrypted keystores as its primary custody model. The Tenzro-native model is a **passkey-quorum**: a *threshold share* of the identity's signing key sits in the user's device, unlockable only by the platform passkey (Apple Passkeys / Google Passkeys / WebAuthn / FIDO2), and a complementary share sits in the Tenzro node TEE. Both signatures are required for every transaction; neither side can sign alone.

For testnet and pre-launch the quorum is **2-of-2** (one user device + node TEE). Before MainNet launch, the default extends to **2-of-3** with a second user device joining the quorum, so loss of any single side — phone, laptop, or TEE access — is recoverable without invoking the social-recovery path. The signing primitives (FROST-Ed25519, threshold-ECDSA / FROST-secp256k1, see §4.3.5) are the same in both configurations; only the threshold and the number of paired devices change. This document specifies the 2-of-2 testnet shape in §4.3.1–§4.3.5, then describes the 2-of-3 extension in §4.3.6.

This is governed by the network: every Tenzro RPC node hosts the canonical onboarding/sign page (`https://<node>/wallet/...`) under the same TLS/auth surface that hosts the JSON-RPC. The wallet's job is to drive that flow and assemble signatures; the node's job is to be the always-available rendezvous point and the TEE-side co-signer.

#### 4.3.1 Why this, not seed phrases or single-key MPC

- **Phishing resistance.** Passkeys are bound to the relying-party origin (`tenzro.network` and any user-pinned RPC origin). A phishing site cannot trick the platform authenticator into producing the passkey assertion needed to unwrap the device share.
- **No key escape via screenshot/clipboard.** The share never decodes outside the platform authenticator's secure enclave (Secure Enclave on iOS/macOS, StrongBox on Android, TPM on Windows, dedicated chip on FIDO2 keys). It is also never visible in plaintext memory of the wallet's JS runtime.
- **Network can't sign alone.** The TEE share is one of two; without the user's passkey-asserted device leg, no Tenzro signature is valid. The network is a co-signer, not a custodian.
- **OS-native UX.** Onboarding and signing use a passkey ceremony users already understand: Face ID / Touch ID / Windows Hello / a Google prompt. No one writes down 12 words.
- **Composes with TDIP and AP2.** The passkey assertion can be re-presented as a `dpop_jkt`-style binding when the wallet authenticates to RPC, so the same user-presence proof that authorises the on-chain signature also authorises the surrounding API call. Mastercard Agent Pay and AP2 mandate verification can demand passkey-fresh assertions for high-value steps.
- **Pre-launch upgrade path is straightforward.** Adding a second user device to the quorum (2-of-3) is purely additive — the device share, the TEE share, and the threshold-signing scheme all stay the same; only the threshold parameter and the device-count change.

#### 4.3.2 Provisioning flow

1. User visits a Tenzro RPC node's onboarding page (e.g. `https://rpc.tenzro.network/wallet/new`) on their phone or laptop.
2. The page runs a passkey ceremony (`navigator.credentials.create`) bound to the Tenzro-network relying-party id. The platform authenticator generates a passkey credential and returns the `credentialId` + public key.
3. Server-side, the node TEE generates a fresh Tenzro identity, splits the signing key into 2 shares (this device + node TEE), and returns the device's share **wrapped with a key derived from the passkey assertion** (HKDF over the authenticator's private-key-derived secret, exposed via `largeBlob` extension or PRF extension where available; falls back to wrapping with a server-held key escrowed under the same passkey if the platform doesn't support PRF yet).
4. The wrapped share is stored in IndexedDB / OS keychain; the unwrap key never leaves the authenticator.
5. The TEE share is registered in the node TEE's keystore (Tenzro Cortex), keyed off the new DID.
6. The DID Document is registered with the device's passkey public key listed under `verificationMethod` with `tenzro:role: "device-share"`. The node TEE share is similarly listed with `tenzro:role: "tee-share"`. The threshold record is `2-of-2`.

After step 6 the user has a working 2-of-2 quorum and can transact on testnet. Pre-launch this provisioning extends to deal a third share to a second user device; see §4.3.6.

#### 4.3.3 Signing flow

For every transaction the kernel constructs the canonical preimage (per §4.5 / wallet-sdk docs) and collects 2 signatures: one from the user's device, one from the node TEE.

1. Kernel signs the preimage on the device it's running on, gated by a passkey assertion (`navigator.credentials.get` with `userVerification: "required"`; the assertion's signature is mixed into the preimage so the assertion is bound to *this specific tx*).
2. Kernel calls `tenzro_signAndSendTransaction` with the local signature share + the passkey-asserted DPoP-bound session JWT. The node TEE supplies its share, combines, and submits in one round-trip.
3. The TEE refuses to co-sign without a fresh, in-window passkey assertion bound to this preimage. There is no "session token rubber-stamp" path — every signature requires a real `userVerification` on a user device.

Step 2 is what the SDK exposes today via `tenzro_signAndSendTransaction`. The TEE's contribution is the *threshold complement*, not a unilateral signature; it is verifiable as such by the node's signature-aggregation logic.

#### 4.3.4 Per-surface keys under threshold

The identity has one root signing key per surface (Ed25519 for Tenzro native, secp256k1 for EVM, Ed25519 for SVM, Ed25519 for Canton). Each is held under the same 2-of-2 passkey-quorum. Threshold signing schemes per surface:

- **Ed25519 (Tenzro native, SVM, Canton):** FROST-Ed25519 (RFC 9591). Mature, well-implemented, fits 2-of-2 directly and extends to 2-of-3 unchanged.
- **secp256k1 (EVM):** FROST-secp256k1 or GG20/CGGMP21-style threshold ECDSA. We pick whichever has the cleanest WASM-compatible implementation at build time.
- **ML-DSA-65 (Tenzro native, hybrid leg):** **open question**, see §11. Threshold ML-DSA is research-stage. M5 ships with the *node TEE* supplying the ML-DSA leg alone (treating ML-DSA as a node-TEE-only signature initially) while the user-device leg is FROST-Ed25519 over the same preimage. The hybrid still verifies because the canonical preimage's `Transaction::hash()` covers both pubkeys; the threshold property only applies to the Ed25519 leg. Documented trade-off until threshold ML-DSA is production-ready.

#### 4.3.5 Recovery (testnet, 2-of-2)

In a 2-of-2 quorum, loss of either side breaks signing. Recovery paths:

- **Device lost, TEE survives:** user opens any Tenzro RPC node's `/wallet/recover` page on a new device, runs a passkey ceremony, and submits a recovery proof (verified email, social-recovery delegates per TDIP, or Tenzro-id KYC re-assertion as the user pre-registered at provisioning). On success, the TEE re-randomises the device leg and deals a fresh share to the new device. The TEE *can* drive this rotation gated by the recovery proof — that is by design; the TEE share is the institutional fallback for users who keep it in their quorum.
- **TEE share unavailable for that DID:** rare in practice (the TEE keystore is replicated across Tenzro Cortex nodes), but if it happens, fall back to social recovery via TDIP delegates: ≥k of the user's pre-registered delegates co-sign a recovery attestation that the network verifies, and a fresh quorum is dealt against the same DID. Same primitive Argent and Safe use, Tenzro-native (delegates are TDIP DIDs, verification on Tenzro Ledger).
- **Lost everything including delegate access:** the DID is unrecoverable. Documented at provisioning time as the consequence of refusing to designate delegates.
- **Compromise suspected:** the user re-runs the recovery flow and supplies a recovery proof. The TEE re-randomises both shares; the DID stays the same, the public keys rotate.

The 2-of-3 pre-launch upgrade (§4.3.6) materially improves this: loss of any one side stops being a recovery event because the remaining 2 still meet threshold.

#### 4.3.6 Pre-launch upgrade: 2-of-3

Before MainNet launch, the default quorum extends to 2-of-3 by adding a second user device. The mechanism:

1. On the originally-paired device, the wallet generates a one-shot pairing token and asks the node to register it (POST `/wallet/pairing/start`). The node returns a short-lived URL (`https://<node>/wallet/pair?session=<token>`) and a TTL.
2. The wallet renders that URL as a QR code.
3. On the second device, the user scans → opens the URL → runs a passkey ceremony.
4. The originally-paired device, **after a passkey assertion of its own**, participates in a threshold-share-redeal protocol with the node TEE that dealss the existing key into 3 shares (this device, new device, TEE) and updates the threshold to 2-of-3.
5. The DID Document is updated to add the new device's passkey public key to `verificationMethod` and the threshold record becomes `2-of-3`.

After this, any 2 of the 3 shares can sign — including the two user-device combination, which means the user can transact without the TEE participating, useful for offline / sovereignty cases. The TEE share remains for recovery and for one-tap signing when only one of the user's devices is to hand.

This whole flow is implemented in M5 alongside the rest of the passkey-quorum custody system; it lands as part of "M5 ships testnet 2-of-2; M5.5 / pre-launch ships 2-of-3."

#### 4.3.7 Canton wrinkle (unchanged from prior design)

Canton parties on Canton MainNet must be **external parties** — the party private key is held client-side, the validator only relays. Under the passkey-quorum model:

- The Canton-shaped Ed25519 key is one of the per-surface keys held under the same 2-of-2 (or 2-of-3, post-launch) quorum.
- External-party allocation against the Tenzro validator (or user-chosen validator) uses the Splice Wallet SDK's external-key flow.
- Every Canton command is *prepared* by the validator's Ledger API, *threshold-signed* by the quorum, *submitted* back through the validator.

This is the same model Loop, Dfns, and Fireblocks use for Canton custody, except the threshold-signing is passkey-quorum instead of HSM-quorum.

### 4.4 Canton-internal surface (M4): same protocol, different synchronizer

`canton-internal` is the same Canton protocol stack as `canton-external` (§4.5), pointed at a Tenzro-operated synchronizer instead of the Global Synchronizer. The justification for keeping it as a distinct surface (rather than a routing detail under one "canton" surface) is operational, not protocol-level:

- **Different synchronizer id, different validator endpoint, different topology.** A `canton-internal` party is hosted on a Tenzro-operated participant connected to the Tenzro synchronizer; a `canton-external` party is hosted on the same Tenzro-operated participant but connected to the Global Synchronizer. The party id, hosting participant id, and `synchronizerId` field on every prepared submission differ. Conflating them in one surface means every call site needs a runtime branch.
- **Different asset model.** `canton-external` is Canton Coin (`splice-amulet 0.1.17`, governed by SVs on the GSF). `canton-internal` is a Tenzro-local asset model — same `Splice.Amulet` semantics for `Numeric 10` decimals and `TransferPreapproval` patterns, but the asset symbol set is Tenzro-controlled (TNZO and any future Tenzro-issued Daml assets) and the governance hooks aren't routed to the GSF.
- **Different fee model.** Canton Coin fees are denominated in CC and routed through SV reward distribution. Tenzro-internal fees are denominated in TNZO and follow the same fee model as `tenzro-native` — pointer-friendly, no SV economics.
- **Same auth, different scope.** Both surfaces talk to a Canton validator over the JSON Ledger API; both use Auth0 client_credentials. The audience/JWT scope differs because the validator-app distinguishes the two synchronizers internally.

What is *not* different:

- The Interactive Submission Service flow (§4.5.1): wallet builds `Commands` → validator returns `PreparedTransaction` + hash → wallet recomputes hash, asserts, signs → executes. Same proto, same hash purpose 11, same `HASHING_SCHEME_VERSION_V2` pinning.
- The two-key party model (§4.5.4): namespace key + signing keys + threshold. Same `SurfaceKey` shape, with `synchronizerId` pointing at the Tenzro synchronizer instead of `global-domain::<fp>`.
- The two transfer paths (preapproval vs Token Standard two-step). Same routing logic at `prepare()` time.
- `watch()` against `/v2/commands/completions` — Canton has no confirmation depth on either synchronizer.

**Implementation consequence.** The shared Canton machinery (port shape, `PreparedTransaction` decoding, hash recomputation, completion tail) lives in `ports/canton/` once and both surfaces consume it. The surface modules differ only in which synchronizer they target and which asset symbols they expose.

**Caveat.** There is no public reference for embedding the Daml interpreter inside a *non-Canton* VM runtime — the "Tenzro VM runs Daml directly" Option B/C from the original brief. If `canton-internal` ever means anything other than "Tenzro-operated synchronizer + Canton participant," this surface gets revisited. Until then, Option A is the only canonical interpretation.

### 4.5 Canton-external surface (M4): protocol, ports, identity

The Canton MainNet surface is structurally different from the EVM/SVM/Tenzro-native surfaces and warrants its own architecture section. The shape `prepare → sign → submit → watch` is the same; everything *inside* those calls is different.

#### 4.5.1 What's distinct about Canton 3.5

- **Two-phase ledger, not signed-tx-and-broadcast.** The wallet does not compute a canonical hash of its own transaction body. The validator's Interactive Submission Service does it. Flow: client builds a `Commands` object → `POST /v2/interactive-submission/prepare` → validator returns `{ preparedTransaction: bytes, preparedTransactionHash: bytes, hashingSchemeVersion }` → wallet **re-decodes the proto to verify what's being authorized**, **recomputes the hash and asserts equality**, signs the hash, → `POST /v2/interactive-submission/execute` with the signed hash. (Canton OSS source of truth: `community/ledger/ledger-api/src/main/protobuf/com/digitalasset/canton/ledger/api/v2/interactive/interactive_submission_service.proto`.)
- **Hash binding.** SHA-256, Canton **hash purpose 11** prefix, **`HASHING_SCHEME_VERSION_V2`**. Pin the scheme version explicitly — V3 will ship eventually and silently break unverified clients.
- **No "address" — only parties.** A party id is `<hint>::<32-byte-fingerprint-hex>`, e.g. `kraken::1220dd08…`. There is no checksum and no derivation from a single key. Human-readable resolution uses **Canton Name Service** (`name.cns` → party id) via `/v0/scan-proxy/ans-entries/by-name/{name}`.
- **Two keys per party, not one.** External parties have a **namespace key** (roots the identity, fingerprint = the `::xxxx` part of the party id, used for topology changes) and one or more **signing keys** with M-of-N threshold registered via `PartyToKeyMapping`. The current single-key `SurfaceKey` shape can't represent this; see §4.5.4.
- **Two transfer paths.** With recipient `TransferPreapproval` → `TransferPreapproval_Send`, single tx, atomic, true `final-on-submit`. Without → Token Standard two-step (lock + accept), recipient must accept, **`reversibility: 'reversible-until-confirmed'`** with hours-to-days pendency.
- **CC is `Numeric 10` carried as decimal strings** on the JSON wire (`"10.0"`). Never JS number, never bigint base units. The marshalling lives at the port boundary.
- **No confirmation depth.** Canton has single-event finality from the synchronizer's mediator — `created` → `submitted` → `executed | failed`. The TransferOffer branch adds an `awaiting-acceptance` wallet-side state that is *not* a protocol event.
- **JWT auth, not DPoP.** The Tenzro-operated Canton validator authenticates via Auth0 client_credentials, audience `https://canton.network.global`. Different plumbing from `TenzroRpcPort`'s session model — Canton needs its own port.

#### 4.5.2 CIP-0103 + Splice Wallet Kernel positioning

CIP-0103 (status: **Approved 2026-01-29**, amended 2026-03-25) is the dApp↔wallet JSON-RPC standard for Canton. It's "EIP-1193 for Canton." The CIP itself is intentionally a thin spec — it explicitly defers normative API shape to the OpenRPC files in [`hyperledger-labs/splice-wallet-kernel`](https://github.com/hyperledger-labs/splice-wallet-kernel):

- `api-specs/openrpc-dapp-api.json` — Sync transport (browser-extension form factor)
- `api-specs/openrpc-dapp-remote-api.json` — Async transport (server-side wallet, `userUrl` redirect; this is the Tenzro Wallet form factor)
- `api-specs/openrpc-signing-api.json` — Gateway↔signing-provider contract; the extension point for out-of-process signers

The Splice Wallet Kernel is **the** reference implementation, not a competing standard. Its layered architecture: dApp → `dapp-sdk` → Wallet Gateway (`wallet-gateway-remote` server, or `wallet-gateway-extension` MV3 — the latter is **not yet implemented upstream as of v1.1.0**) → Signing Provider via the Signing API → Canton validator's Ledger API.

**Tenzro Wallet's positioning:**

- Tenzro Wallet is a **CIP-0103-compliant Async wallet**. Generate TS bindings from `openrpc-dapp-remote-api.json` so the wire contract is mechanically faithful.
- The passkey-quorum custody (§4.3) implements the **Signing API** (`openrpc-signing-api.json`) — a JSON-RPC endpoint hosted on every Tenzro RPC node, exposing `signTransaction / getTransaction / getTransactions` to any `wallet-gateway-remote` deployment that wants to delegate to a Tenzro node. Cleaner than a TS-only driver and reuses the same RPC trust boundary as the rest of the wallet's `/wallet/*` endpoints.
- **WalletConnect** went live on Canton 2026-04-27. It sits *alongside* CIP-0103 as transport/discovery, not a replacement; the wire methods are still CIP-0103. Tenzro Wallet ships a WalletConnect bridge that proxies WC sessions to the CIP-0103 endpoint. Discovery for institutional dApps lands here.

CIP-0103 still doesn't standardize multi-provider discovery in a browser-extension context (explicitly "future CIP, not yet filed"). For the extension form factor we follow EIP-6963-style multi-provider conventions on our own.

#### 4.5.3 The CantonValidatorPort

Analogous to `TenzroRpcPort`: a narrow interface with one adapter (`SpliceValidatorAdapter`) that imports from `@canton-network/wallet-sdk` (or talks the JSON Ledger API directly when the SDK doesn't fit). Keeps the kernel free of Canton SDK churn. **Both `canton-external` and `canton-internal` consume this port** (§4.4) — the port is synchronizer-agnostic; the synchronizer id is a parameter on the prepared submission, not a port-level concern.

```ts
interface CantonValidatorPort {
  // Interactive Submission Service (the only signed-tx path)
  prepareSubmission(req: PrepareSubmissionRequest): Promise<PrepareSubmissionResponse>;
  executeSubmission(req: ExecuteSubmissionRequest): Promise<void>;

  // Completion + state
  tailCompletions(filter: { userId: string; actAs: string[]; beginExclusive?: string }):
    AsyncIterable<Completion>;
  getActiveContracts(filter: ActiveContractsFilter): AsyncIterable<ActiveContract>;

  // Splice-specific reads (Scan-proxied)
  lookupPreapproval(party: string): Promise<TransferPreapproval | null>;
  resolveCns(name: string): Promise<string | null>;

  // Onboarding (validator-app endpoints, not raw Ledger API)
  generateTopology(req: GenerateTopologyRequest): Promise<GenerateTopologyResponse>;
  submitTopology(req: SubmitTopologyRequest): Promise<void>;
  setupProposal(req: SetupProposalRequest): Promise<void>;
  prepareAcceptSetup(req: PrepareAcceptRequest): Promise<PrepareAcceptResponse>;
  submitAcceptSetup(req: SubmitAcceptRequest): Promise<void>;
}
```

The `prepareSubmission` request must carry `packageIdSelectionPreference` pinned to the `splice-amulet` package ID the wallet knows how to render. Post-2026-05-05 baseline: `splice-amulet 0.1.17`.

#### 4.5.4 SurfaceKey shape change for Canton

```ts
{ surface: 'canton-external';
  partyId: string;                                  // <hint>::<fingerprint>
  namespaceKey: { scheme: 'ed25519'; publicKey: Uint8Array };
  signingKeys: ReadonlyArray<{
    scheme: 'ed25519' | 'ec-dsa-p256';
    publicKey: Uint8Array;
  }>;
  threshold: number;                                // M of len(signingKeys)
  hostingParticipantId: string;
  synchronizerId: string;                           // global-domain::<fp> for MainNet
}
```

`canton-internal` mirrors this shape with the Tenzro-operated synchronizer's id.

The namespace key is the cold/recovery key (used for topology changes — adding signing keys, rotating, adding hosting participants). Signing keys are the warm/online keys (per-tx). **Don't reuse the namespace key as a signing key in production** — a hot signing-key compromise must not be a namespace compromise. The passkey-quorum quorum holds the namespace key under the strictest threshold (e.g. always require both user device + TEE in 2-of-2; require all 3 in the 2-of-3 mode); signing keys can be lower-threshold for routine sends.

#### 4.5.5 Signature schemes

Canton 3.5 documented external-signing curves: **Ed25519** (`SIGNING_ALGORITHM_SPEC_ED25519`) and **ECDSA P-256** (`SIGNING_ALGORITHM_SPEC_EC_DSA_SHA_256`). secp256k1 support for external parties on Global Synchronizer MainNet is **unclear in public docs** as of 2026-04 — verify before locking. ECDSA P-256 maps cleanly to WebAuthn passkey ES256 output, so passkey-direct signing is feasible for the signing-key leg if the passkey-derived key is registered in `PartyToKeyMapping`. For the namespace key we default to Ed25519 (matches FROST-Ed25519 in the quorum, matches the Splice Wallet Kernel's internal driver).

#### 4.5.6 Onboarding flow against the Tenzro validator

Tenzro operates a non-SV Canton validator running a Splice 0.5.x baseline. Standard Canton ports apply: Splice validator-app on `:5003`, participant Ledger API on `:7575`, Auth0 audience `https://canton.network.global`. The wallet kernel reads the actual base URLs and audience from env vars (`CANTON_LEDGER_BASE_URL`, `CANTON_VALIDATOR_BASE_URL`, etc — see `.env.example`); operational specifics are tracked privately.

Onboarding a Tenzro Wallet user as a Canton external party against this validator:

1. Wallet generates namespace + signing keypairs locally (passkey-bound, under the §4.3 quorum).
2. `POST /api/validator/v0/admin/external-party/topology/generate` → validator returns 3 unsigned topology txs (NamespaceDelegation, PartyToKeyMapping, PartyToParticipant) + a bundle hash.
3. Quorum signs the bundle hash with the namespace key (SHA-256, hash purpose 55 for the multi-tx bundle).
4. `POST .../topology/submit` with the signed bundle.
5. `POST .../setup-proposal` → validator becomes preapproval *provider*.
6. `POST .../setup-proposal/prepare-accept` → quorum signs → `submit-accept`. User now has a `TransferPreapproval` (90-day expiry, auto-renewed by the validator's automation when within 30 days of expiry).

Subsequent sends bypass the validator-app `/v0/wallet/*` convenience endpoints and go direct to `:7575/v2/interactive-submission/*` — keeps the wallet vendor-neutral against the JSON Ledger API rather than coupled to Splice validator-app endpoint stability.

#### 4.5.7 watch() against the Update Service

Canton has no `pending → confirmed → finalized` walk. The right model: tail `/v2/commands/completions` filtered by `userId`/`actAs`, surface the completion as the single finality event, in parallel tail `/v2/updates/flats` filtered to the user's party to render the projected transaction tree.

CIP-0103 maps this to `txChanged` events with states `pending → signed → executed | failed`, payloads `{ commandId, updateId, completionOffset }`. The TransferOffer branch produces an extra wallet-side `awaiting-acceptance` state that is bookkept locally — there's no protocol event for it.

### 4.6 Custody: signing-driver abstraction

Per-share storage and signing is pluggable so each leg of the quorum is a separate driver and we can add institutional ones later without rewriting the kernel:

- `passkey-share` — passkey-bound device share. Used on every paired user device. Implements PRF/largeBlob unwrap + threshold-share signing.
- `node-tee-share` — Tenzro Cortex TEE share, accessed via `tenzro_signAndSendTransaction` with the local share's contribution attached. Always present in the testnet 2-of-2 quorum and present-by-default in the 2-of-3 pre-launch quorum.
- `pairing-channel` — (2-of-3 pre-launch only) virtual driver that posts a sign-request to the user's other paired device through the node-hosted pairing channel and waits for the threshold-share signature back. Lets two user devices alone meet the threshold.
- `core-signing-fireblocks` — institutional users who already custody on Fireblocks. Replaces one of the device shares; rest of the quorum is unchanged.
- `core-signing-blockdaemon` — same idea, Blockdaemon Builder Vault.
- `core-signing-participant` — Canton participant-managed parties for users who *want* validator-custodied Canton keys (e.g. exchanges). Only applies to the Canton surface key, not the rest of the identity.

(`core-signing-*` driver names match Splice Wallet Kernel deliberately — we reuse those drivers where they fit.)

---

## 5. The unified balance view

This is the single most user-visible win. From the user's perspective, they have *assets*, not *accounts on a VM*.

### 5.1 What the kernel does on every refresh

```
for each asset the user holds:
  if asset.scope == "tenzro-native":
    balance = nativeRpc.getBalance(did)
    surfaces_visible_on = ["native", "evm-on-tenzro", "svm-on-tenzro", "canton-on-tenzro"]
  elif asset.scope == "external-evm":           # e.g. ETH on Ethereum mainnet
    balance = ethRpc.getBalance(evmAddr)
    surfaces_visible_on = ["external-evm"]
  elif asset.scope == "external-svm":           # e.g. SOL on Solana mainnet
    balance = solRpc.getBalance(svmPubkey)
    surfaces_visible_on = ["external-svm"]
  elif asset.scope == "canton-mainnet":         # e.g. CC, tokenized RWAs
    balance = spliceWalletSdk.getHoldings(partyId)
    surfaces_visible_on = ["canton-mainnet"]
```

The UI groups by **asset**, not by chain. A user sees:

```
TNZO        287,871.47    [native]
            (visible on EVM as wTNZO, SVM as SPL, DAML as CIP-56 — same balance)
USDC        12,400.00     [Tempo]   2,500.00 [external Ethereum]
SOL         8.3           [external Solana]
CC          287,871.47    [Canton MainNet]
USTreasury  100,000.00    [Canton MainNet · CIP-56 tokenized]
```

Critically, sending TNZO between EVM and SVM views shows **no fee, no bridge step, no confirmation that hints at risk** — it's a balance-view change. Sending TNZO out to external Ethereum *does* go through the bridge router and shows the full bridge confirmation.

### 5.2 The decimal problem

EVM uses 18 decimals; SVM uses 9; DAML uses arbitrary `Numeric n`. The wallet always stores TNZO balances as canonical native units (the source of truth). Display conversion happens at the UI layer. Sub-lamport dust truncation on the SVM side is a real edge case ([cross-vm-tokens](https://tenzro.com/docs/cross-vm-tokens)) — the wallet shows a small banner ("9 sub-units below SVM precision will not appear in Solana programs") rather than silently rounding.

### 5.3 Canton UTXO management

Canton CIP-56 holdings are UTXO-style ([token standard](https://docs.global.canton.network.sync.global/app_dev/token_standard/index.html)). Splice docs warn against >10 UTXOs per user — fragmentation makes transfers expensive. The wallet runs a background *MergeDelegation* job: any time the user has more than 8 holdings of the same asset on Canton MainNet, it submits a merge. This also generates featured-app rewards, so it's net-positive in fees.

---

## 6. Sending money: one consent flow, four routes

### 6.1 Intent → route decision

The user expresses intent: "send X of asset A to recipient R". The kernel routes:

| Source surface | Destination | Route |
|---|---|---|
| Tenzro EVM view | Tenzro SVM view | Pointer op via precompile `0x1003` (no fee) |
| Tenzro native | External Ethereum | Tenzro→Ethereum bridge: LI.FI / CCIP / LayerZero (BridgeRouter chooses) |
| Tenzro native | Canton MainNet | CantonAdapter handoff → external Canton party of recipient |
| Canton MainNet | Canton MainNet | Splice Wallet SDK; transfer-preapproval if recipient has one, else two-step transfer offer |
| External Ethereum | Tenzro native | Bridge inbound (LayerZero/CCIP) |
| External Solana | Tenzro native | LI.FI or Wormhole |
| Tenzro EVM | External Ethereum EVM (same chain assets) | direct EVM bridge |

Bridge-router strategy is user-selectable: **cost** (default), **speed**, or **availability** ([bridge docs](https://tenzro.com/docs/bridge)). Quotes from all adapters are fetched in parallel; the user sees the chosen route with a one-click "use a different bridge" affordance.

### 6.2 The Canton MainNet edge cases (verified)

Drawing from operating the Tenzro validator and the verified Canton 3.5 behaviour:

- **Two transfer choices, one underlying primitive.** Both flows ultimately exercise `AmuletRules_Transfer` on the singleton `AmuletRules` contract. They differ in inputs/outputs:
  - **`TransferPreapproval_Send`** — single tx, atomic, requires recipient has a `TransferPreapproval` contract. **Default for Tenzro Wallet when preapproval is present.**
  - **Token Standard two-step** (CIP-0056) — `lock` inputs, recipient `unlock`s; calls `AmuletRules_Transfer` internally on acceptance. **Used when recipient lacks preapproval.** `expires_at` is microseconds-since-epoch on the wire.
- **Both validator-app convenience endpoints (`/v0/wallet/transfer-preapproval/send` and `/v0/wallet/token-standard/transfers`) translate to the same `AmuletRules_Transfer` choice underneath.** The Token Standard path is *not* a workaround for package mismatches — both fail or succeed together. (We verified this on 2026-04-30 against the live validator.)
- **`description` is the memo.** Carries the Kraken 10-digit numeric, etc. Distinct from `tracking_id` (which is for client-side dedup, not visible to the recipient) and `deduplication_id` (idempotency at the validator). The wallet treats "exchange recipient" as a first-class address-book entry that prompts for memo before submit.
- **Preapproval setup at onboarding.** `Splice.Wallet.TransferPreapproval`, 90-day expiry, ~$1/year (paid in CC, *burned*), auto-renewed by the validator's automation when within 30 days of expiry. Created during the §4.5.6 onboarding via `ExternalPartySetupProposal`. Discoverable by senders via `/v0/scan-proxy/transfer-preapprovals/by-party/{party}`.
- **CC fees are zero.** Per CIP-0078, all CC transfers are zero-fee; only holding fees apply at expiry. The wallet displays fees as 0 from the live `AmuletConfig` rather than hard-coding.
- **Featured-app rewards.** Transfers using a preapproval whose `provider` is featured-app create an `AppRewardCoupon` for the provider on the same tx. Wallet renders this as an info badge, not as a fee — it's revenue for the validator operator, not a cost to the user.
- **Decimal marshalling.** CC is `Numeric 10` carried as decimal strings (`"10.0"`) on the JSON wire. Never JS number, never bigint base units. Marshalling happens at the `CantonValidatorPort` boundary; the kernel's `Intent.amount: bigint` is converted to canonical decimal-string form there.
- **Package set baseline.** Wallet ships after the 2026-05-05 SV vote that activates `splice-amulet 0.1.17` on MainNet. We pin `packageIdSelectionPreference: [<0.1.17 package id>]` on every `prepareSubmission` so the validator can't silently pick a version the client can't render. The in-flight 0.1.16↔0.1.17 transition window is not modelled.
- **Cantonscan blocks programmatic fetchers.** For confirmation links, the wallet opens Cantonscan in the user's actual browser (deep link), not a webview.

### 6.3 Preview, sign, submit

Every send goes through three explicit kernel calls:

```ts
const preview = await kernel.prepare({ from, to, asset, amount, memo? })
// preview includes: route, surface, fee breakdown, ETA, reversibility class, warnings
const signed = await kernel.sign(preview, { consent: userConfirmation })
const handle = await kernel.submit(signed)
const status = await kernel.watch(handle)
```

`preview.warnings` is where surface-specific gotchas surface to the UI: Canton package mismatch, SVM dust truncation, EVM nonce gap, Ethereum fee spike, Solana priority fee underpayment, etc. The UI pattern is "no surprises after the user has clicked sign."

---

## 7. Settlement: escrow, channels, x402, MPP, AP2

The wallet exposes Tenzro's settlement primitives as first-class flows, not just signing endpoints.

### 7.1 Escrow

[Tenzro escrow](https://tenzro.com/docs/escrow) is a Native VM primitive — selectors `0x01000010` (create), `0x01000011` (release), `0x01000012` (refund). The wallet wraps these as:

```ts
kernel.escrow.create({
  payer: did,
  payee: recipientDid,
  asset: "TNZO",            // or any registered asset
  amount,
  expiresAt,
  release: "timeout"        // | "providerSig" | "consumerSig" | "bothSigs"
                            // | "verifierSig" (TEE/ZK attestor) | "custom"
})
```

Six release modes need six UI patterns. The wallet ships defaults:
- **Timeout** — "lock for N days; auto-refund if not released" (the simple case for AI-inference settlement).
- **VerifierSignature** — the wallet pairs with a TEE attestor or ZK prover; the verifier's identity (a TDIP DID) is shown to the user before lock. This is the killer feature for "pay agent X if and only if it ran in a verified TEE."
- **BothSignatures** — escrow flow shows the counterparty's pending status; both UIs surface a single "release" button.

The wallet maintains a *local escrow ledger* that watches `tenzro_listEscrowsByPayer` and `tenzro_listEscrowsByPayee`, plus expiry timers, plus the underlying state keys (`escrow:<id>`, etc.). State survives node restart on Tenzro's side; the wallet just needs to re-subscribe.

**Cross-chain escrow.** For the Canton case — "escrow CC on Canton MainNet for delivery of a Tenzro-side AI inference" — the wallet uses the AP2/x402 pattern: the Canton-side asset stays on Canton, the agreement is mediated by an AP2 session on Tenzro, and settlement happens via the bridge after release. A Canton-native escrow primitive is tracked for inclusion once Splice's allocation contracts mature.

### 7.2 Micropayment / nanopayment channels

Channels are critical for streaming AI inference (per-token billing). The kernel handles:

- **Open** — escrow TNZO with TTL; channel id derived deterministically
- **Update** — both parties co-sign new (balance, nonce); state lives in the wallet's local store
- **Close** — submit final state on-chain; 1h dispute window
- **Settle** — 0.5% fee on final balance

Wallet UX: a single "stream" entry in the activity feed that ticks live as updates happen, then collapses to a single settlement line on close. Failure modes — counterparty disappears mid-stream, network down at close time — are handled by automatic re-broadcast within the dispute window, with a visible "re-broadcasting" state.

### 7.3 x402 (HTTP 402 paywalled resources)

Per [x402 docs](https://tenzro.com/docs/x402): the wallet intercepts HTTP 402 challenges (via the SDK or via an in-wallet browser/agent runtime), executes the on-chain payment, builds the `X402PaymentPayload` (UUID + payer + recipient + amount + tx_hash + Ed25519 sig over canonical bytes + timestamp), base64-encodes, attaches `X-Payment` header, retries.

This is single-shot. For repeated calls to the same provider, the wallet automatically *upgrades* to MPP (sessions) or a nanopayment channel — its choice is based on observed call frequency. The user sees one "session with provider X" entry, not N tiny payments.

### 7.4 MPP, AP2, Visa TAP, Mastercard Agent Pay

All four are payment-protocol modules in the kernel ([payments overview](https://tenzro.com/docs/payments)). They share two invariants:

1. **Spending is bounded by `effectiveLimit = sessionPolicy ∩ delegationScope`.** The wallet enforces this at sign time, not at preview time, because session policies can be revoked mid-session.
2. **All of them resolve counterparty identity through TDIP**, not through ad-hoc registries. This means the wallet shows "alice.tenzro" or "openai.com" (verified via DID) rather than a raw address.

For Mastercard Agent Pay specifically, KYA tier maps to a per-session cap; the wallet refuses to issue a session token that exceeds the user's KYA tier (and surfaces the upgrade path).

### 7.5 Paymaster / gas sponsorship

ERC-4337 v0.8 on the EVM-on-Tenzro side. The wallet:
- Constructs UserOps for any EVM call where the user has no TNZO (or for app-sponsored calls).
- Talks to a registered paymaster (the dApp's own, or a default Tenzro public paymaster).
- Per [paymaster docs](https://tenzro.com/docs/paymaster), the user never sees gas costs in sponsored flows.

SVM and Canton don't have direct paymaster equivalents documented. For SVM-on-Tenzro we provide a *fee delegation* shim: the wallet asks the Tenzro RPC to fee-delegate via the same paymaster master wallet, deducting in TNZO. For Canton MainNet, the *provider* of a transfer-preapproval pays fees by design — that *is* Canton's paymaster, and the wallet uses it transparently.

---

## 8. dApp API surface

### 8.1 Primary: CIP-103 + Tenzro extensions

The wallet exposes a CIP-103-compatible JSON-RPC 2.0 API at `window.tenzro` (and `window.canton` as an alias for Canton-only dApps), with EIP-1193-style event semantics. Methods are namespaced:

- `tenzro_*` — wallet-level (createWallet, balance, send, escrow, channel, history, signAndSendTransaction, setDelegationScope)
- `tdip_*` — identity (resolve, addCredential, sign DPoP, prove KYA tier)
- `canton_*` — Canton-specific (allocateExternalParty, prepareCommand, signCommand, submit) — same as Splice Wallet Kernel
- `eth_*` — EIP-1193 shim for EVM dApps
- `solana_*` — Solana wallet-adapter shim for SVM dApps
- `pay_*` — payment protocols (mpp, x402, ap2, visa-tap, mastercard-agentpay)

A dApp that knows nothing about Tenzro can use just `eth_*` or `solana_*` and gets a working EVM/SVM wallet. A Tenzro-native dApp uses `tenzro_*` and gets unified balances, cross-VM moves, and TDIP identity for free.

### 8.2 SDK packages

```
tenzro-wallet       — the kernel core, Node + browser
@tenzro/wallet-react        — React hooks (useTenzroWallet, useBalance, useSend, useEscrow)
@tenzro/wallet-shadcn       — shadcn-styled UI primitives (consent dialog, balance card, send flow)
@tenzro/wallet-canton       — thin re-export of @canton-network/wallet-sdk wired to our kernel
@tenzro/wallet-evm-shim     — EIP-1193 provider that proxies into the kernel
@tenzro/wallet-svm-shim     — Solana wallet-adapter that proxies into the kernel
```

Default consumer: `@tenzro/sdk`'s `TenzroClient.wallet` already exposes `signAndSend`, `sessionKeys`, etc. — we keep those signatures so existing Tenzro code doesn't break. The kernel is the new layer underneath.

---

## 9. Form factors

We ship three from day one and a fourth shortly after:

1. **Browser extension** (Chromium + Firefox). Injects `window.tenzro` and `window.canton`. Same kernel running in a service worker; UI in popup + side panel. This is the dApp connector.
2. **Web app** at `wallet.tenzro.com` (Next.js App Router on Vercel). Standalone wallet UI. Imports the same kernel. Useful for first-time users who don't want to install anything.
3. **Desktop** (Tauri, mirroring the Tenzro desktop stack — Tauri + React + Tailwind 4 + OKLCH per the architecture doc). For power users who want local node integration and deeper key custody.
4. **Mobile** (React Native + Expo, post-v1). Holds a passkey-bound device share natively (Secure Enclave / StrongBox), receives QR-pairing requests, and acts as the second signer in Path A flows. Push notifications for sign-requests, incoming transfers, and channel events.

All four share `tenzro-wallet`. UI code is duplicated minimally — most of it is in `@tenzro/wallet-react` + `@tenzro/wallet-shadcn`.

---

## 10. Concrete first milestones

| # | Milestone | Acceptance |
|---|---|---|
| 1 | Kernel skeleton | TS monorepo (pnpm + turborepo), `tenzro-wallet` package, in-memory signing stub, all four surface modules with mock RPCs, full type contracts on every method |
| 2 | Tenzro native surface live (Path B only) | Linked `tenzro-sdk`, real RPC, server-side hybrid signing via `tenzro_signAndSendTransaction` + DPoP-bound session, `wallet create / balance / send` work on testnet. Custody is "node TEE + DPoP-asserted browser session" — passkey-quorum lands in M5. |
| 3 | EVM + SVM surfaces (on-Tenzro) | Cross-VM pointer transfers between wTNZO and SPL-TNZO views via precompile `0x1003`; unified balance card |
| 4a | **Canton design + ports (M4 design phase)** | Pre-2026-05-05 work: (1) DESIGN.md §4.4 + §4.5 finalised — both surfaces specced, port shape pinned, `SurfaceKey` shape change documented; (2) `CantonLedgerPort` interface declared in `ports/canton/` (no SDK adapter yet); (3) `CantonIdentityPort` declared (DID → partyId, parallel to `TenzroIdentityPort`); (4) `SurfaceKey` variants for `canton-internal` / `canton-external` extended to namespace + signing keys + threshold + hosting participant + synchronizerId; (5) `cantonInternalSurface` + `cantonExternalSurface` wired to ports — `sign`/`submit` delegate to ports, ports throw "SDK pending" until 4b lands; (6) typecheck + tests still green. |
| 4b | **Canton MainNet surface live (M4 SDK phase)** | Post-2026-05-05 work, gated on the Splice 0.5.x baseline being available: (1) `SpliceValidatorAdapter` — the only file importing `@canton-network/wallet-sdk`; (2) Onboarding flow against `topology/{generate,submit}` + `setup-proposal/{prepare-accept,submit-accept}`; (3) `PreparedTransaction` proto vendored from Canton OSS, re-decoded for user verification, hash recomputed and asserted (SHA-256, hash purpose 11, `HASHING_SCHEME_VERSION_V2` pinned); (4) Two-path transfer routing (preapproval vs Token Standard two-step) with Scan preapproval lookup; (5) CC `Numeric 10` decimal-string marshalling at the port boundary; (6) `watch()` against `/v2/commands/completions`; (7) CIP-0103 Async dApp API endpoint generated from `openrpc-dapp-remote-api.json`, hosted on Tenzro RPC nodes; (8) Signing API endpoint generated from `openrpc-signing-api.json` so any `wallet-gateway-remote` can delegate to Tenzro; (9) WalletConnect bridge proxying WC sessions to the CIP-0103 endpoint; (10) `splice-amulet 0.1.17` pinned in `packageIdSelectionPreference`. Validates against the Tenzro-operated Canton validator. |
| 5 | **Passkey-quorum custody (testnet 2-of-2)** | The §4.3 model end to end at the testnet shape: passkey-bound device share + node-TEE share, FROST-Ed25519 + FROST-secp256k1 threshold signing, node-hosted `/wallet/new` and `/wallet/recover` pages, DID Document with both pubkeys, recovery via passkey + pre-registered proof. Replaces the M2 "node-TEE + DPoP-asserted browser session" temporary custody with the network-governed model. |
| 5.5 | **2-of-3 pre-launch upgrade** | QR pairing flow for second user device, threshold-redeal protocol (2-of-2 → 2-of-3), `pairing-channel` driver for two-user-device signing without TEE, social recovery via TDIP delegates. Lands before MainNet. |
| 6 | Browser extension | `window.tenzro` provider, EIP-1193 + Solana wallet-adapter shims, end-to-end flow with a sample Tenzro dApp |
| 7 | Settlement primitives | Escrow create/release/refund (all 6 release modes), nanopayment channel open/update/close, x402 HTTP-402 interception |
| 8 | Bridge router | LI.FI + CCIP + LayerZero adapters; route-selection UI; first cross-chain Tenzro→Ethereum and Tenzro→Canton-MainNet move |
| 9 | TDIP integration | DID provisioning at first launch, DID Document export, AP2 + Mastercard Agent Pay sessions with KYA tier checks |

Milestones 1–5.5 are the unique-and-hard part. 6 onward is mostly assembly.

### 10.1 Deferred work

The following items have ports / shapes pinned but full implementation is gated. They're called out so the milestone scope stays honest.

| Area | Deferred element | Gate | Kernel state |
|---|---|---|---|
| M5 | `core-signing-frost-secp256k1` + `core-signing-frost-ed25519` device drivers | Library selection (ZF `frost-ed25519` / `frost-secp256k1`, NCC-audited Oct 2023; ship as wasm-bindgen WASM) — host loads WASM at construction time | **Drivers + coordinator port + HTTP adapter shipped.** `frostEd25519Driver()` + `frostSecp256k1Driver()` orchestrate the 3-round protocol against `FrostCoordinator`. `FrostHttpAdapter` (at `src/custody/frost/http-adapter.ts`) implements that port against Tenzro `/wallet/frost/{ed25519,secp256k1}/*`. `FrostBackend` injection point includes `frostBackendUnavailable()` (typed-throw stub) and `composeFrostBackend({ed25519, secp256k1})` (per-curve dispatch) at `src/custody/frost/backend.ts`; host plugs in WASM-wrapped ZF FROST. |
| M5 | ML-DSA-65 leg threshold-signing | Audited threshold ML-DSA library exists (NIST IR 8214C tracks it; nothing audited as of 2026-05) | **TEE-only path shipped + HTTP adapter shipped.** `MlDsaCoordinator` exposes `mode: 'tee-only' \| 'threshold'`; `hybridEd25519MlDsaDriver()` composes FROST-Ed25519 + node-TEE ML-DSA in parallel. `MlDsaHttpAdapter` (at `src/custody/mldsa/http-adapter.ts`) wraps `/wallet/mldsa/{capabilities,sign}`. When `capabilities().mode` flips to `'threshold'`, the driver swaps without caller change. |
| M5 | PRF/largeBlob-vs-escrow share-unwrap path | Runtime branch in device-provisioning UI | **Unwrapper + HTTP adapter + WebAuthn adapter shipped.** `PasskeyShareUnwrapper` does capability-driven mode selection (PRF > largeBlob > escrow), wipes share bytes on dispose. `ShareEnvelopeHttpAdapter` (at `src/custody/passkey-share/http-adapter.ts`) wraps `/wallet/share/{envelope,escrow/challenge,escrow/unwrap}`. `WebAuthnAuthenticatorAdapter` (at `src/custody/passkey-share/webauthn-adapter.ts`) implements the browser-side `PasskeyAuthenticatorAdapter`: PRF as primary path (CTAP2.1 hmac-secret), largeBlob fallback, plain assertion for escrow. UI still out of kernel scope. |
| M5 | Provisioning + recovery flows (§4.3.2 / §4.3.5) | Tenzro `/wallet/{new,recover}/*` endpoints | **Orchestrators shipped.** `walletNew()` (at `src/identity/wallet-new.ts`) drives the §4.3.2 flow: `ProvisioningPort.start` → `PasskeyEnroller.enroll` (`navigator.credentials.create`) → `ProvisioningPort.finalize` → optional `DeviceShareStore.put` → `confirm`, with cancel-on-failure rollback. `walletRecover()` mirrors it for §4.3.5 against `/wallet/recover/*`, accepting `email-otp` / `social` (delegate signatures) / `tenzro-id-kyc` proof envelopes plus a `forceRotate` flag for compromise-suspected paths. Both replace M1 `provisionIdentity()` deterministic mock; the M1 helper is retained for tests. |
| M5.5 | Delegate-set-size UX | UX validation against onboarding tests | **Done in kernel.** `DelegateSetConfig` + `validateDelegateSet` + `defaultDelegateSet` (3-of-5 default, k/n configurable up to 5-of-7) shipped at `src/identity/delegate-set.ts`. |
| M6 | `window.tenzro` injection — EIP-6963 announcement | Browser-extension package (`@tenzro/wallet-extension`) | **Builder shipped in kernel; consume side SDK-supplied.** Announce side: `buildEip6963Announcement()` at `src/dapp/eip6963.ts` (default rdns sourced from the SDK's `TENZRO_PROVIDER_RDNS = 'network.tenzro.wallet'` so announce/consume are aligned by import). Consume side: `tenzro-sdk` exports `discoverEip6963Provider`, `Eip1193Transport`, and `TenzroNotInstalledError`; the kernel re-exports them via `src/dapp/index.ts`. Injected-provider adapter path: `TenzroSdkAdapter.fromInjected({rdns, timeoutMs, config})` in `src/ports/adapters/tenzro-sdk-adapter.ts` wraps `TenzroClient.fromInjected()` so dApp hosts get a kernel-shaped `TenzroRpcPort` whose RPC calls travel through `provider.request(...)` instead of a fetch endpoint. The browser-extension package (M6) still owns the actual `window.tenzro` injection + `dispatchEvent`. |
| M7 | Visa TAP credential signer + Mastercard Agent Pay token issuance | `tenzro-sdk` `PaymentClient.signVisaTap` + `issueMastercardToken` | **Settle-side live; issuance pending.** `payVisaTap()` + `payMastercard()` shipped in `tenzro-sdk@0.2.0` (`tenzro_payVisaTap` / `tenzro_payMastercard` RPCs); the wallet's `payment-rails-adapter` calls them through. Issuance-side hooks (`signVisaTap()` / `issueMastercardToken()` on `PaymentRailsPort`) still throw "SDK pending" until the issuance SDK methods exist; wire mapping is final. |
| M7 | OpenAI ACP buyer adapter | `tenzro-sdk` `AcpClient` | **Adapter wired against structural `AcpClientLike`.** `AcpSdkAdapter` mirrors public ACP v1 wire shape; swap structural type for SDK type when it ships. |
| M8 | Bridge router adapters (LI.FI / CCIP / LayerZero / Wormhole / deBridge / Canton) | `tenzro-sdk` `client.bridge.{getRoutes,bridgeTokens,getTransferStatus,listAdapters}` | **Live on testnet.** `BridgeRoutePort` in `src/ports/bridge/bridge.ts` + six per-vendor adapters in `src/ports/bridge/adapters/`. All adapters forward to the SAME `client.bridge` (`getRoutes` + `bridgeTokens` shipped in `tenzro-sdk@0.2.0`) and pass `vendor: BridgeAdapterId` as a multiplexing arg — matching what Tenzro ships (one router, six vendor IDs). |
| ERC-7802 | SuperchainERC20 cross-chain mint/burn calldata | `tenzro-sdk` `client.erc7802().{crosschainMint,crosschainBurn}` | **Live on testnet.** `Erc7802Port` at `src/ports/agent/erc7802.ts`; `Erc7802SdkAdapter` calls `Erc7802Client.{crosschainMint,crosschainBurn}` (shipped in `tenzro-sdk@0.2.0`) and returns `{to, data, value}` calldata that the wallet routes through the `evm-on-tenzro` surface for signing. |
| Cross-chain escrow | HTLC-style Tenzro↔Canton escrow | Splice allocation-contract maturity + Tenzro VM HTLC tx_type | **Port + adapter shipped (SDK-pending).** `HtlcEscrowPort` at `src/ports/agent/htlc-escrow.ts`; `HtlcEscrowSdkAdapter` calls `tenzro-sdk` `SettlementClient.{lockHtlc,redeemHtlc,refundHtlc,getHtlc}` when present, throws "SDK pending" otherwise. Wire shape (`/v1/htlc/*`, base64-encoded secrets) pinned. |
| Cross-cutting | Receive-memo generalisation (§11.9) | None — straightforward shape | **Done in kernel.** `MemoSpec` on `Intent` + `SurfaceModule.memoSpec()` + `kernel.memoSpec(intent)`; canton-external surface returns the canonical 256-char text spec. |

### 10.2 Tenzro endpoints needed (kernel consumes; Tenzro implements)

The kernel-side ports + adapters above target a stable set of Tenzro-hosted endpoints. They're enumerated here so the Tenzro RPC implementation has a single contract to ship against. All requests use snake_case wire form; the wallet kernel translates to camelCase + `bigint` at the adapter boundary. All endpoints are JSON over HTTPS unless noted (the bridge `track` may stream).

**Custody — FROST round-coordination** (`src/custody/frost/coordinator.ts`)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/wallet/frost/{ed25519\|secp256k1}/start` | `{did, surface_key, scheme, preimage_b64, purpose?}` | `{session_id, expires_at, participants[]}` |
| POST | `/wallet/frost/{ed25519\|secp256k1}/commit` | `{session_id, device_commitment_b64}` | `{session_id, state}` |
| POST | `/wallet/frost/{ed25519\|secp256k1}/await-challenge` | `{session_id}` (long-poll) | `{session_id, state, group_commitment_b64, signer_set[], lambda_b64}` |
| POST | `/wallet/frost/{ed25519\|secp256k1}/respond` | `{session_id, device_share_b64}` | `{session_id, state}` |
| POST | `/wallet/frost/{ed25519\|secp256k1}/finalize` | `{session_id}` | `{session_id, state, signature_b64}` |
| POST | `/wallet/frost/{ed25519\|secp256k1}/abort` | `{session_id, reason?}` | (idempotent) |

**Custody — ML-DSA-65** (`src/custody/mldsa/coordinator.ts`)

| Method | Path | Body | Response |
|---|---|---|---|
| GET  | `/wallet/mldsa/capabilities` | — | `{mode: 'tee-only'\|'threshold', public_key?}` |
| POST | `/wallet/mldsa/sign` | `{did, surface_key, preimage_b64, purpose?}` | `{signature_b64}` (3293 bytes) |
| POST | `/wallet/mldsa/{start-round,commit,respond,finalize}` | (parallel to FROST shape) | (threshold mode only — gated on NIST IR 8214B) |

**Custody — Passkey share unwrap** (`src/custody/passkey-share/unwrapper.ts`)

| Method | Path | Body | Response |
|---|---|---|---|
| GET  | `/wallet/share/envelope?credential_id=…&surface_key=…` | — | `{wrapped_share_b64, alg, salt_b64}` (PRF/largeBlob path) |
| POST | `/wallet/share/escrow/challenge` | `{credential_id, surface_key}` | `{nonce, expires_at}` |
| POST | `/wallet/share/escrow/unwrap` | `{credential_id, surface_key, assertion, nonce}` | `{wrapped_share_b64, pepper_b64}` |

**Custody — QR pairing** (`src/custody/pairing/port.ts` — already shipped)

| Method | Path | Notes |
|---|---|---|
| POST | `/wallet/pairing/{start,claim,poll,finalize,cancel}` | 2-of-2 → 2-of-3 redeal |

**HTLC cross-chain escrow** (`src/ports/agent/adapters/htlc-escrow-adapter.ts`)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/v1/htlc/lock` | `{payer, payee, amount, asset, secret_hash_b64, expires_at_unix_ms, destination_corridor}` | `{htlc_id, tx_hash, status}` |
| POST | `/v1/htlc/redeem` | `{htlc_id, secret_b64, proof}` (proof is corridor-shaped) | `{tx_hash}` |
| POST | `/v1/htlc/refund` | `{htlc_id}` | `{tx_hash}` |
| GET  | `/v1/htlc/{htlc_id}` | — | `HtlcRecord` snake_case |

**Bridge router** (`src/ports/bridge/adapters/`) — the wallet exposes one `BridgeRoutePort` per vendor (LI.FI / CCIP / LayerZero / Wormhole / deBridge / Canton) but all six adapters forward to a single shared `client.bridge` that multiplexes on a `vendor` field. This matches what `tenzro-sdk` ships (`client.bridge.getRoutes / bridgeTokens / getTransferStatus / listAdapters`).

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/v1/bridge/quote` | `{vendor, from_chain, to_chain, from_address, to_address, from_asset, amount, prefer?}` | `{to_amount, fees, eta_sec, opaque, summary}` |
| POST | `/v1/bridge/build` | `{vendor, opaque}` | `{transactions[{chain, body, label}], tracker_id}` |
| GET  | `/v1/bridge/track` (`?vendor=…&tracker_id=…`) | — | stream of `{tracker_id, phase, source_tx?, destination_tx?, error?}` |
| GET  | `/v1/bridge/adapters` | — | `{vendors: BridgeAdapterId[]}` (which vendors are live) |

For Canton, the build step emits a DAML command body (`transactions[].body = {command: …}`, `chain = 'canton-mainnet'`) rather than an EVM tx — same wire envelope, different payload shape.

**ERC-7802 SuperchainERC20** (`src/ports/agent/adapters/erc7802-adapter.ts`)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/v1/erc7802/crosschain-mint` | `{token, to, amount, source_chain, source_tx_hash}` | `{to, data, value}` (EVM calldata) |
| POST | `/v1/erc7802/crosschain-burn` | `{token, from, amount, destination_chain}` | `{to, data, value}` (EVM calldata) |

**Already-live endpoints (consumed via existing `tenzro-sdk` clients)**

- `tenzro_signAndSendTransaction` + DPoP-bound session (M2 baseline)
- Wallet-control RPCs `/wallet/{new,recover,balance,send,…}` (per `reference_tenzro_architecture`)
- Canton ledger-API `/v2/{commands,state,topology,…}` (M4b)
- AP2 / ERC-8004 / agent-payment / nanopayment / session-key / TEE-attestation / native escrow / payment-rails RPCs

The endpoint set above is what the Tenzro RPC + node TEE need to host for milestones M5 onward to light up end-to-end.

---

## 11. Open questions / things to nail down before building

1. **Threshold ML-DSA-65.** Hybrid signing on Tenzro native is Ed25519 + ML-DSA-65. FROST-Ed25519 is mature; threshold ML-DSA is research-stage. M5 ships with the Ed25519 leg threshold-signed across the device-quorum and the ML-DSA leg supplied by the node TEE alone (which means *the TEE is in every Tenzro-native sig until threshold ML-DSA exists*). When does that change? Track [NIST IR 8214B](https://csrc.nist.gov/projects/threshold-cryptography) and the FROST-PQ literature; revisit when an audited, WASM-shippable implementation exists.
2. **secp256k1 for Canton external parties.** Canton 3.5 documents Ed25519 and ECDSA P-256 for `SigningAlgorithmSpec`. secp256k1 acceptance on Global Synchronizer MainNet is unclear in public docs as of 2026-04 — verify via the Canton crypto provider's enum in OSS source and the SV-allowlisted curves before locking in. If secp256k1 isn't accepted, the EVM-leg key cannot double as a Canton signing key for users who want a single keypair across surfaces; document the constraint at onboarding.
3. **PRF/largeBlob fallback for share unwrap.** WebAuthn PRF and largeBlob extensions are the cleanest way to derive a share-unwrap key from a passkey assertion, but Safari/iOS support is partial as of 2026-04. For platforms that lack PRF, fall back to wrapping the share with a server-held key escrowed under a per-passkey envelope (the node TEE holds the envelope key; the passkey assertion authorises decryption). Document the threat-model difference between PRF-mode and escrow-mode share storage.
4. **Hashing scheme version migration.** Canton currently mandates `HASHING_SCHEME_VERSION_V2` for prepared-transaction hashing. A V3 will ship eventually, with different proto canonicalisation rules. The wallet's hash recomputation breaks silently if it's not version-aware. Strategy: pin the version explicitly in code, reject `prepareSubmission` responses carrying a version the wallet doesn't implement, fail loudly. Track Canton release notes for the V3 announcement; treat scheme upgrades as forced-upgrade events for the wallet.
5. **PreparedTransaction proto vendoring strategy.** ~~The proto is in Canton OSS (`community/ledger/ledger-api/.../interactive_submission_service.proto`) but not published as an npm package independent of the full SDK. Options: (a) vendor the `.proto` into `tenzro-wallet` and generate TS bindings at build time, (b) consume `@canton-network/wallet-sdk`'s exported types and accept the version pinning that comes with it, (c) hand-write a minimal subset of the proto types we actually decode.~~ **Resolved (2026-04):** option (b) — consume `@canton-network/wallet-sdk`'s exported types via `SpliceValidatorAdapter`. The adapter is the only kernel file that imports the Canton SDK; the version pinning is contained there and aligns with our `splice-amulet 0.1.17` pin. Vendoring (a) was rejected as duplicate maintenance; hand-rolling (c) was rejected as a re-decoding gap risk.
6. **dApp provider discovery in the browser-extension form factor.** ~~CIP-0103 explicitly defers multi-provider discovery to "a future CIP" that has not been filed.~~ **Resolved (2026-04):** follow [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) conventions for in-page provider announcement (`eip6963:announceProvider` / `eip6963:requestProvider` with a Tenzro-namespaced `info.rdns`). WalletConnect remains the bridge for institutional/server dApps. Revisit if a Canton CIP lands.
7. **Cross-chain escrow.** Punted for v1 (use AP2 + bridge). v2 candidate: hashed-timelock-style escrow that locks on Tenzro and unlocks on Canton on proof of Canton-side delivery. Needs Splice allocation-contract maturity. **Partial coverage shipped (2026-05):** for SuperchainERC20-compatible tokens (TNZO + others), `Erc7802Port` provides supply-consistent crosschain mint/burn that bypasses bridge aggregators entirely — no escrow needed when the token itself is ERC-7802. The HTLC port (§11.7) still covers the Canton corridor where DAML settlement is needed.
8. **Stablecoin on Tempo.** ~~[Tempo integration](https://tenzro.com/docs/tempo) is in the docs as TIP-20 USDC/USDT with sub-second finality. Treat Tempo as a fifth surface or as an asset-routing detail under the existing surfaces?~~ **Resolved (2026-04):** asset-routing detail. Tempo is reachable through the existing EVM and Tenzro-native surfaces; users see "USDC" with a "Tempo" badge in the unified balance view. No fifth surface, no new `SurfaceKey` variant. Routing decisions land in `selectRoute()` based on asset preference + corridor availability.
9. **Receive memos for non-Canton chains.** Some external chains (e.g. Stellar, XRPL via bridge) require memos. Generalize the "exchange recipient with memo" pattern across all surfaces, not just Canton.
10. **Social-recovery delegate set size.** §4.3.6 specifies "k of n TDIP delegates" but doesn't fix the numbers. 3-of-5 is the Argent default; 2-of-3 is friendlier; 5-of-7 is exchange-grade. **Deferred to UX validation (M5.5):** ship 3-of-5 default, allow user-configurable k/n at delegate-set creation, validate against onboarding usability tests before MainNet.

### 11.1 SDK gaps — ports declared, adapters pending

The wallet kernel follows an adopt-don't-rebuild stance: protocol primitives live in `tenzro-sdk`, the wallet wraps them via thin `*-SdkAdapter` files. The following ports are declared with stable shapes but their adapters land only when the SDK ships the underlying client. Each is tracked as a separate work item.

| Port | SDK client expected | Status | Notes |
|---|---|---|---|
| `AcpPort` (`src/ports/agent/acp.ts`) | `AcpClient` (buyer-side) | **adapter wired against structural `AcpClientLike`** | `AcpSdkAdapter` mirrors public ACP v1 wire shape (snake_case ↔ camelCase, exact-optional `reason`). When `tenzro-sdk` ships `AcpClient`, swap `AcpClientLike` for the SDK type — wire mapping is unchanged. Tests pin the mapping today against a fake client. |
| Visa TAP credential signer | `PaymentClient.signVisaTap()` | **port hook + adapter wired with detect-via-presence** | `PaymentRailsPort.signVisaTap()` declared; `PaymentRailsSdkAdapter` calls `client.signVisaTap` if present, throws "SDK pending" otherwise. `signature-input`/`signature` header composition stays in the SDK (kernel is browser-clean). |
| Mastercard Agent Pay token | `PaymentClient.issueMastercardToken()` | **port hook + adapter wired with detect-via-presence** | `PaymentRailsPort.issueMastercardToken()` declared; adapter forwards to `client.issueMastercardToken` when present, throws "SDK pending" otherwise. Token-kind enum (`SingleUse` / `SessionBound` / `Recurring`) pinned. |
| Auth engine `listSessions` | `AuthClient.listSessions(controllerDid)` | adapter optional-throws | `SessionKeySdkAdapter.list()` throws "SDK pending" if the auth client doesn't expose `listSessions`. Lift the throw when the method ships. |

When the SDK adds the missing client, the kernel-side change is mechanical: for the ACP and PaymentRails entries, the wire mapping is already pinned by tests, so the swap is a one-line type change plus deleting the `'SDK pending'` throw branch. The `*-SdkAdapter.ts` pattern (mirroring AP2/ERC-8004/AgentPayment) only needs creating from scratch for fully-new ports.

---

## 12. Why not just use what exists

- **MetaMask + Phantom + Splice Wallet UI + tenzro-cli** — four UIs, four seed phrases, four consent flows, no unified balance, no cross-VM pointer awareness. The whole point of Tenzro's runtime is wasted at the UX layer.
- **Fork MetaMask, add SVM and Canton** — MetaMask's account model is single-secp256k1-key-per-account. TDIP, passkey-quorum custody, and Canton external parties all violate that assumption. The fork would be 80% rewrite.
- **Use Splice Wallet Kernel as-is** — it's Canton-only. Brilliant for Canton, but no EVM/SVM/Tenzro-native surface, no AP2, no x402.
- **Wallet-as-a-service (Dynamic, Privy, Web3Auth)** — closes the seed-phrase problem but doesn't solve the multi-VM, TDIP, settlement-primitive, or Canton-external-party problems, and they custody keys on their servers (not in the user's passkey-protected secure enclaves). Useful as a *signer driver* for users who want it (we'd add `core-signing-privy` to the driver list), not as the wallet's default.
- **MPC-as-a-service (Fireblocks, Coinbase WaaS, Lit Protocol)** — solves threshold signing but doesn't solve passkey UX, multi-VM, or Canton. A `core-signing-fireblocks` driver makes sense for institutional users; for everyone else, the Tenzro-native passkey-quorum is the answer.

The right move is to build the kernel, reuse Splice Wallet Kernel patterns where they fit (CIP-103, signing-driver shape, external party flow), and own the unifying layer ourselves.

---

## 13. References

- Tenzro docs: [architecture](https://tenzro.com/docs/architecture), [multi-vm](https://tenzro.com/docs/multi-vm), [cross-vm-tokens](https://tenzro.com/docs/cross-vm-tokens), [identity (TDIP)](https://tenzro.com/docs/identity), [custody](https://tenzro.com/docs/custody), [wallet-sdk](https://tenzro.com/docs/wallet-sdk), [paymaster](https://tenzro.com/docs/paymaster), [bridge](https://tenzro.com/docs/bridge), [payments](https://tenzro.com/docs/payments), [x402](https://tenzro.com/docs/x402), [escrow](https://tenzro.com/docs/escrow), [micropayments](https://tenzro.com/docs/micropayments), [settlement](https://tenzro.com/docs/settlement), [canton](https://tenzro.com/docs/canton), [typescript-sdk](https://tenzro.com/docs/typescript-sdk)
- Canton: [Splice Wallet Kernel](https://github.com/hyperledger-labs/splice-wallet-kernel), [Validator APIs](https://docs.sync.global/app_dev/validator_api/index.html), [Token Standard (CIP-56)](https://docs.global.canton.network.sync.global/app_dev/token_standard/index.html), [Transfer Preapprovals](https://docs.dev.sync.global/background/preapprovals.html), [Splice repo](https://github.com/hyperledger-labs/splice)
- Internal: private operations document tracks the Tenzro Canton MainNet validator's operational state (endpoints, infra, holdings, contacts)
