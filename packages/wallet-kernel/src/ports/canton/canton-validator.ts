/**
 * CantonValidatorPort — narrow port for the Canton validator surface area.
 *
 * Two protocol surfaces hide behind one port:
 *   1. **Ledger API** (`/v2/...`) — the JSON Ledger API every Canton
 *      participant exposes. Interactive Submission Service for prepare/execute,
 *      command completions tail, active-contract reads.
 *   2. **Splice validator-app** (`/api/validator/v0/...`) — the Tenzro-hosted
 *      validator's convenience endpoints for external-party onboarding (topology
 *      generation, setup-proposal acceptance, preapproval lookup via Scan proxy).
 *
 * Both surfaces sit on the same validator deployment and share auth (Auth0
 * JWT, audience `https://canton.network.global`). One port, one adapter,
 * one set of auth plumbing — the kernel doesn't care that two HTTP base URLs
 * are involved.
 *
 * Both `canton-internal` and `canton-external` consume this port. The
 * synchronizerId is a parameter on every call, not a port-level concern —
 * the same Tenzro validator hosts parties on both the Tenzro-operated
 * synchronizer and the Global Synchronizer.
 *
 * **Backed by:** `LedgerApiAdapter` (browser-clean, hand-rolled fetch
 * client over the JSON Ledger API + Splice validator-app HTTP surface).
 * Following Splice Wallet Kernel's reference pattern — no
 * `@canton-network/wallet-sdk` dep (that package is Node-only, pulls
 * `@grpc/grpc-js`). CIP-0103 explicitly endorses raw Ledger API access
 * as a canonical source of truth.
 *
 * Spec refs:
 *   - DESIGN.md §4.4 (canton-internal) + §4.5 (canton-external)
 *   - Canton OSS `interactive_submission_service.proto` for the prepare/execute
 *     wire shape (vendored hash recomputation lives in `./hash.ts`)
 *   - https://docs.digitalasset.com/integrate/devnet/preparing-and-signing-transactions/
 *   - https://docs.global.canton.network.sync.global/
 *   - Splice Wallet Kernel `core/ledger-client` (the reference HTTP client
 *     pattern this adapter mirrors)
 */

// ─────────────────────────── Interactive Submission ───────────────────────────

/**
 * Hashing scheme version for `preparedTransactionHash` recomputation.
 * Pin V2 explicitly; reject V3+ until the kernel knows the V3 canonicalisation
 * rules. Per §4.5.1 and open-question #4 in DESIGN.md.
 */
export type CantonHashingSchemeVersion = 'HASHING_SCHEME_VERSION_V2';

/**
 * Canton signing curves accepted on `PartyToKeyMapping`. Ed25519 is the
 * recommended default; ECDSA P-256 maps cleanly to WebAuthn ES256 for
 * passkey-direct signing of the warm leg. secp256k1 acceptance on Global
 * Synchronizer MainNet is unverified as of 2026-04 — see DESIGN.md open
 * question #2.
 */
export type CantonSigningScheme = 'ed25519' | 'ec-dsa-p256';

export interface PrepareSubmissionRequest {
  /** Acting party id (`<hint>::<fingerprint>`). */
  readonly actAs: string;
  /** Synchronizer id — `global-domain::<fp>` for MainNet, Tenzro-operated
   *  synchronizer id for canton-internal. */
  readonly synchronizerId: string;
  /** Stable client-side identifier; tied to the eventual `updateId`. */
  readonly commandId: string;
  /** Pinned package id the wallet knows how to render. Post-2026-05-05
   *  baseline: `splice-amulet 0.1.17`. */
  readonly packageIdSelectionPreference: string;
  /** Daml `Commands` payload — opaque to the kernel; the SDK adapter shapes
   *  this from the high-level intent. M4 design phase keeps the type narrow;
   *  the SDK adapter widens it to the Splice `wallet-sdk` Commands shape. */
  readonly commands: ReadonlyArray<unknown>;
}

export interface PrepareSubmissionResponse {
  /** Canonical wire-format `PreparedTransaction` proto bytes. The wallet
   *  re-decodes these to verify what's being authorised. */
  readonly preparedTransaction: Uint8Array;
  /** SHA-256 hash with Canton hash purpose 11 prefix. The wallet recomputes
   *  this from `preparedTransaction` and asserts equality before signing. */
  readonly preparedTransactionHash: Uint8Array;
  readonly hashingSchemeVersion: CantonHashingSchemeVersion;
}

export interface ExecuteSubmissionRequest {
  readonly preparedTransaction: Uint8Array;
  /** The signature(s) over `preparedTransactionHash`. M-of-N signing keys
   *  per `PartyToKeyMapping` — array even when threshold = 1. */
  readonly partySignatures: ReadonlyArray<{
    readonly party: string;
    readonly signature: Uint8Array;
    readonly scheme: CantonSigningScheme;
    /** Fingerprint of the signing public key — Canton uses this to look up
     *  the key in `PartyToKeyMapping` rather than carrying the pubkey on
     *  the wire. */
    readonly signedBy: string;
  }>;
  readonly hashingSchemeVersion: CantonHashingSchemeVersion;
  /** Same `commandId` from prepare. */
  readonly submissionId: string;
}

// ─────────────────────────────── Completions ───────────────────────────────

export interface CompletionFilter {
  readonly userId: string;
  readonly actAs: ReadonlyArray<string>;
  /** Resume from a prior offset; omit to start from the current head. */
  readonly beginExclusive?: string;
}

export interface CantonCompletion {
  readonly commandId: string;
  /** On-ledger update id — the closest equivalent to a tx hash. */
  readonly updateId: string;
  readonly completionOffset: string;
  readonly status: 'executed' | 'failed';
  /** Status detail when `status === 'failed'`. */
  readonly errorMessage?: string;
}

// ─────────────────────────────── Active state ───────────────────────────────

export interface ActiveContractsFilter {
  readonly party: string;
  readonly templateIds?: ReadonlyArray<string>;
}

export interface CantonActiveContract {
  readonly contractId: string;
  readonly templateId: string;
  /** Daml record payload, opaque to the kernel; surface modules narrow this
   *  per template. */
  readonly payload: unknown;
  readonly createdAtOffset: string;
}

export interface TransferPreapproval {
  readonly contractId: string;
  readonly receiver: string;
  readonly provider: string;
  /** Unix ms epoch of preapproval expiry. The Tenzro validator auto-renews
   *  when within 30 days of expiry (see §4.5.6). */
  readonly expiresAt: number;
}

// ─────────────────────────────── Onboarding ───────────────────────────────

export interface GenerateTopologyRequest {
  readonly partyHint: string;
  readonly namespacePublicKey: Uint8Array;
  readonly signingPublicKeys: ReadonlyArray<{
    readonly publicKey: Uint8Array;
    readonly scheme: CantonSigningScheme;
  }>;
  readonly threshold: number;
}

export interface GenerateTopologyResponse {
  /** The three unsigned topology transactions (NamespaceDelegation,
   *  PartyToKeyMapping, PartyToParticipant) as opaque bytes. The wallet
   *  doesn't decode these — it signs the bundle hash. */
  readonly topologyTransactions: ReadonlyArray<Uint8Array>;
  /** SHA-256 over the bundle, Canton hash purpose 55. */
  readonly bundleHash: Uint8Array;
  /** Resulting party id once the bundle is submitted. */
  readonly partyId: string;
}

export interface SubmitTopologyRequest {
  readonly topologyTransactions: ReadonlyArray<Uint8Array>;
  readonly namespaceSignature: Uint8Array;
}

export interface SetupProposalRequest {
  readonly partyId: string;
}

export interface PrepareAcceptSetupRequest {
  readonly partyId: string;
}

export interface PrepareAcceptSetupResponse {
  readonly preparedTransaction: Uint8Array;
  readonly preparedTransactionHash: Uint8Array;
  readonly hashingSchemeVersion: CantonHashingSchemeVersion;
}

export interface SubmitAcceptSetupRequest {
  readonly preparedTransaction: Uint8Array;
  readonly signature: Uint8Array;
  readonly hashingSchemeVersion: CantonHashingSchemeVersion;
}

// ─────────────────────────────── Port ───────────────────────────────

export interface CantonValidatorPort {
  // Interactive Submission Service — the only signed-tx path on Canton.
  prepareSubmission(req: PrepareSubmissionRequest): Promise<PrepareSubmissionResponse>;
  executeSubmission(req: ExecuteSubmissionRequest): Promise<void>;

  // Completion + state.
  tailCompletions(filter: CompletionFilter): AsyncIterable<CantonCompletion>;
  getActiveContracts(filter: ActiveContractsFilter): AsyncIterable<CantonActiveContract>;

  // Splice-specific reads (Scan-proxied via the validator-app).
  lookupPreapproval(party: string): Promise<TransferPreapproval | null>;
  /** Canton Name Service: `name.cns` → party id. Returns null when unmapped. */
  resolveCns(name: string): Promise<string | null>;

  // External-party onboarding (validator-app endpoints, not raw Ledger API).
  generateTopology(req: GenerateTopologyRequest): Promise<GenerateTopologyResponse>;
  submitTopology(req: SubmitTopologyRequest): Promise<void>;
  setupProposal(req: SetupProposalRequest): Promise<void>;
  prepareAcceptSetup(req: PrepareAcceptSetupRequest): Promise<PrepareAcceptSetupResponse>;
  submitAcceptSetup(req: SubmitAcceptSetupRequest): Promise<void>;
}
