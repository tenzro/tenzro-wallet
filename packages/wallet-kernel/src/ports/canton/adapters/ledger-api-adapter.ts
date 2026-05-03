/**
 * LedgerApiAdapter — `CantonValidatorPort` backed by the JSON Ledger API
 * + Splice validator-app HTTP surface.
 *
 * Browser-clean by design: only `fetch` + `WebCrypto` (the `http.ts`
 * helpers handle both). No `@canton-network/wallet-sdk` dep — that package
 * pulls `@grpc/grpc-js` which doesn't run in browsers, Workers, or Deno.
 *
 * The adapter mirrors the pattern Splice Wallet Kernel itself uses
 * (`core/ledger-client`): hand-rolled HTTP client over the published JSON
 * Ledger API. CIP-0103 explicitly endorses raw Ledger API access.
 *
 * Wire-format details:
 *   - Bytes are base64-encoded on the JSON Ledger API (handled by the
 *     `replacer` in `http.ts`; decoded back to `Uint8Array` here).
 *   - Bigint amounts are decimal strings on the wire; the kernel keeps them
 *     as bigint internally.
 *   - Completion stream is NDJSON over a keep-alive HTTP/1.1 connection.
 *
 * Spec refs:
 *   - DESIGN.md §4.4 (canton-internal) + §4.5 (canton-external)
 *   - https://docs.digitalasset.com/integrate/devnet/preparing-and-signing-transactions/
 *   - Canton OSS `interactive_submission_service.proto`
 *   - Splice Wallet Kernel `core/ledger-client` (reference pattern)
 */

import type {
  ActiveContractsFilter,
  CantonActiveContract,
  CantonCompletion,
  CantonHashingSchemeVersion,
  CantonValidatorPort,
  CompletionFilter,
  ExecuteSubmissionRequest,
  GenerateTopologyRequest,
  GenerateTopologyResponse,
  PrepareAcceptSetupRequest,
  PrepareAcceptSetupResponse,
  PrepareSubmissionRequest,
  PrepareSubmissionResponse,
  SetupProposalRequest,
  SubmitAcceptSetupRequest,
  SubmitTopologyRequest,
  TransferPreapproval,
} from '../canton-validator.ts';
import {
  base64Decode,
  base64Encode,
  type CantonHttpConfig,
  getJson,
  postJson,
  streamNdjson,
} from '../http.ts';

// ─────────────────────────── wire shapes ───────────────────────────

/**
 * Wire shape for `/v2/interactive-submission/prepare`. Mirrors the
 * Canton OSS `PrepareSubmissionRequest` proto, JSON-encoded. Field names are
 * snake_case per the JSON Ledger API convention.
 */
interface PrepareSubmissionWire {
  readonly user_id: string;
  readonly command_id: string;
  readonly synchronizer_id: string;
  readonly act_as: ReadonlyArray<string>;
  /** Pinned package id; the validator uses this to disambiguate when
   *  multiple packages export the same template name. */
  readonly package_id_selection_preference: ReadonlyArray<string>;
  readonly commands: ReadonlyArray<unknown>;
  /** Tells the validator we'll execute later — it returns proto bytes
   *  + hash rather than committing immediately. */
  readonly verbose_hashing: boolean;
}

interface PrepareSubmissionWireResponse {
  /** Base64-encoded `PreparedTransaction` proto bytes. */
  readonly prepared_transaction: string;
  /** Base64-encoded SHA-256 with hash purpose 11 prefix. */
  readonly prepared_transaction_hash: string;
  readonly hashing_scheme_version: string;
}

interface ExecuteSubmissionWire {
  readonly prepared_transaction: string; // base64
  readonly party_signatures: ReadonlyArray<{
    readonly party: string;
    readonly signature: string; // base64
    readonly signing_algorithm_spec: string; // 'ed25519' | 'ec-dsa-p256'
    readonly signed_by: string;
  }>;
  readonly hashing_scheme_version: string;
  readonly submission_id: string;
  readonly user_id: string;
  /** Deadline relative to validator clock; `0` lets the validator pick. */
  readonly deduplication_period?: { readonly empty: Record<string, never> };
}

interface CompletionsWire {
  readonly user_id: string;
  readonly parties: ReadonlyArray<string>;
  readonly begin_exclusive?: string;
}

interface CompletionStreamElementWire {
  readonly completion?: {
    readonly command_id: string;
    readonly update_id: string;
    readonly offset: string;
    readonly status?: { readonly code: number; readonly message?: string };
  };
}

interface ActiveContractsWire {
  readonly filter: {
    readonly filters_by_party: Record<
      string,
      {
        readonly cumulative: ReadonlyArray<{
          readonly template_filter?: { readonly template_id: string };
          readonly wildcard_filter?: Record<string, never>;
        }>;
      }
    >;
  };
  readonly verbose: boolean;
  readonly active_at_offset: string;
}

interface ActiveContractsResponseElementWire {
  readonly contract_entry?: {
    readonly active_contract?: {
      readonly created_event: {
        readonly contract_id: string;
        readonly template_id: string;
        readonly create_arguments_blob?: string;
        readonly create_arguments?: unknown;
        readonly offset: string;
      };
    };
  };
}

interface PreapprovalLookupWire {
  readonly transfer_preapproval?: {
    readonly contract_id: string;
    readonly payload: {
      readonly receiver: string;
      readonly provider: string;
      readonly expires_at: string; // ISO-8601 or epoch micros — validator returns ISO
    };
  };
}

interface CnsLookupWire {
  readonly entry?: { readonly party_id: string };
}

interface GenerateTopologyWireResponse {
  readonly topology_transactions: ReadonlyArray<string>; // base64
  readonly multi_hash: string; // base64 — the bundle hash
  readonly party_id: string;
}

// ─────────────────────────── adapter ───────────────────────────

export interface LedgerApiAdapterConfig extends CantonHttpConfig {
  /**
   * The Ledger API requires a `user_id` on prepare/execute and completions
   * filters. This is the validator-side identifier of the wallet's
   * application user (Auth0 subject mapped to a Canton user). The host
   * passes it through; the kernel doesn't care about its shape.
   */
  readonly userId: string;
}

export class LedgerApiAdapter implements CantonValidatorPort {
  readonly #cfg: LedgerApiAdapterConfig;

  constructor(cfg: LedgerApiAdapterConfig) {
    this.#cfg = cfg;
  }

  async prepareSubmission(
    req: PrepareSubmissionRequest,
  ): Promise<PrepareSubmissionResponse> {
    const wire: PrepareSubmissionWire = {
      user_id: this.#cfg.userId,
      command_id: req.commandId,
      synchronizer_id: req.synchronizerId,
      act_as: [req.actAs],
      package_id_selection_preference: [req.packageIdSelectionPreference],
      commands: req.commands,
      verbose_hashing: true,
    };
    const res = await postJson<PrepareSubmissionWire, PrepareSubmissionWireResponse>(
      this.#cfg,
      'ledger',
      '/v2/interactive-submission/prepare',
      wire,
    );
    return {
      preparedTransaction: base64Decode(res.prepared_transaction),
      preparedTransactionHash: base64Decode(res.prepared_transaction_hash),
      hashingSchemeVersion: assertHashingScheme(res.hashing_scheme_version),
    };
  }

  async executeSubmission(req: ExecuteSubmissionRequest): Promise<void> {
    const wire: ExecuteSubmissionWire = {
      prepared_transaction: base64Encode(req.preparedTransaction),
      party_signatures: req.partySignatures.map((s) => ({
        party: s.party,
        signature: base64Encode(s.signature),
        signing_algorithm_spec: s.scheme,
        signed_by: s.signedBy,
      })),
      hashing_scheme_version: req.hashingSchemeVersion,
      submission_id: req.submissionId,
      user_id: this.#cfg.userId,
    };
    await postJson<ExecuteSubmissionWire, unknown>(
      this.#cfg,
      'ledger',
      '/v2/interactive-submission/execute',
      wire,
    );
  }

  async *tailCompletions(filter: CompletionFilter): AsyncIterable<CantonCompletion> {
    const wire: CompletionsWire = {
      user_id: filter.userId,
      parties: [...filter.actAs],
      ...(filter.beginExclusive !== undefined
        ? { begin_exclusive: filter.beginExclusive }
        : {}),
    };
    for await (const el of streamNdjson<CompletionStreamElementWire>(
      this.#cfg,
      'ledger',
      '/v2/commands/completions',
      wire,
    )) {
      const c = el.completion;
      if (!c) continue;
      // Canton status codes: 0 = OK, anything else is a failure. The
      // gRPC status carries the structured error in `message`.
      const failed = c.status !== undefined && c.status.code !== 0;
      const completion: CantonCompletion = {
        commandId: c.command_id,
        updateId: c.update_id,
        completionOffset: c.offset,
        status: failed ? 'failed' : 'executed',
        ...(failed && c.status?.message !== undefined
          ? { errorMessage: c.status.message }
          : {}),
      };
      yield completion;
    }
  }

  async *getActiveContracts(
    filter: ActiveContractsFilter,
  ): AsyncIterable<CantonActiveContract> {
    // Active set on the JSON Ledger API needs an offset to read at. We pull
    // the current ledger end first, then read the active set at that point.
    // This matches Splice Wallet Kernel's `getActiveContracts` flow.
    const ledgerEnd = await getJson<{ readonly offset: string }>(
      this.#cfg,
      'ledger',
      '/v2/state/ledger-end',
    );
    const wire: ActiveContractsWire = {
      filter: {
        filters_by_party: {
          [filter.party]: {
            cumulative:
              filter.templateIds === undefined || filter.templateIds.length === 0
                ? [{ wildcard_filter: {} }]
                : filter.templateIds.map((t) => ({
                    template_filter: { template_id: t },
                  })),
          },
        },
      },
      verbose: false,
      active_at_offset: ledgerEnd.offset,
    };
    for await (const el of streamNdjson<ActiveContractsResponseElementWire>(
      this.#cfg,
      'ledger',
      '/v2/state/active-contracts',
      wire,
    )) {
      const ev = el.contract_entry?.active_contract?.created_event;
      if (!ev) continue;
      yield {
        contractId: ev.contract_id,
        templateId: ev.template_id,
        // The validator returns either a structured payload or a base64 blob;
        // the kernel surface narrows this per template, so keep it raw.
        payload: ev.create_arguments ?? ev.create_arguments_blob ?? null,
        createdAtOffset: ev.offset,
      };
    }
  }

  async lookupPreapproval(party: string): Promise<TransferPreapproval | null> {
    // Scan-proxied via the validator-app. The Tenzro validator wraps the
    // global Scan API at `/api/validator/v0/scan-proxy/...`.
    try {
      const res = await getJson<PreapprovalLookupWire>(
        this.#cfg,
        'validator',
        `/api/validator/v0/scan-proxy/transfer-preapprovals/by-party/${encodeURIComponent(party)}`,
      );
      if (!res.transfer_preapproval) return null;
      const p = res.transfer_preapproval;
      return {
        contractId: p.contract_id,
        receiver: p.payload.receiver,
        provider: p.payload.provider,
        expiresAt: parseTimestamp(p.payload.expires_at),
      };
    } catch (e) {
      if (isHttpStatus(e, 404)) return null;
      throw e;
    }
  }

  async resolveCns(name: string): Promise<string | null> {
    try {
      const res = await getJson<CnsLookupWire>(
        this.#cfg,
        'validator',
        `/api/validator/v0/scan-proxy/ans-entries/by-name/${encodeURIComponent(name)}`,
      );
      return res.entry?.party_id ?? null;
    } catch (e) {
      if (isHttpStatus(e, 404)) return null;
      throw e;
    }
  }

  async generateTopology(
    req: GenerateTopologyRequest,
  ): Promise<GenerateTopologyResponse> {
    const wire = {
      party_hint: req.partyHint,
      public_key: base64Encode(req.namespacePublicKey),
      signing_keys: req.signingPublicKeys.map((k) => ({
        public_key: base64Encode(k.publicKey),
        signing_algorithm_spec: k.scheme,
      })),
      threshold: req.threshold,
    };
    const res = await postJson<typeof wire, GenerateTopologyWireResponse>(
      this.#cfg,
      'validator',
      '/api/validator/v0/admin/external-party/topology/generate',
      wire,
    );
    return {
      topologyTransactions: res.topology_transactions.map(base64Decode),
      bundleHash: base64Decode(res.multi_hash),
      partyId: res.party_id,
    };
  }

  async submitTopology(req: SubmitTopologyRequest): Promise<void> {
    const wire = {
      topology_transactions: req.topologyTransactions.map(base64Encode),
      signed_topology_txs: [
        {
          signature: base64Encode(req.namespaceSignature),
          // Namespace key is always Ed25519 per Canton's external-party model.
          signed_by: 'namespace',
          signing_algorithm_spec: 'ed25519',
        },
      ],
    };
    await postJson(
      this.#cfg,
      'validator',
      '/api/validator/v0/admin/external-party/topology/submit',
      wire,
    );
  }

  async setupProposal(req: SetupProposalRequest): Promise<void> {
    await postJson(
      this.#cfg,
      'validator',
      '/api/validator/v0/admin/external-party/setup-proposal',
      { user_party_id: req.partyId },
    );
  }

  async prepareAcceptSetup(
    req: PrepareAcceptSetupRequest,
  ): Promise<PrepareAcceptSetupResponse> {
    const res = await postJson<
      { user_party_id: string },
      {
        readonly transaction: string;
        readonly tx_hash: string;
        readonly hashing_scheme_version: string;
      }
    >(
      this.#cfg,
      'validator',
      '/api/validator/v0/admin/external-party/setup-proposal/prepare-accept',
      { user_party_id: req.partyId },
    );
    return {
      preparedTransaction: base64Decode(res.transaction),
      preparedTransactionHash: base64Decode(res.tx_hash),
      hashingSchemeVersion: assertHashingScheme(res.hashing_scheme_version),
    };
  }

  async submitAcceptSetup(req: SubmitAcceptSetupRequest): Promise<void> {
    const wire = {
      transaction: base64Encode(req.preparedTransaction),
      signed_tx_hash: base64Encode(req.signature),
      hashing_scheme_version: req.hashingSchemeVersion,
      // Setup acceptance is always Ed25519 (signed by the namespace key).
      signing_algorithm_spec: 'ed25519',
    };
    await postJson(
      this.#cfg,
      'validator',
      '/api/validator/v0/admin/external-party/setup-proposal/submit-accept',
      wire,
    );
  }
}

// ─────────────────────────── helpers ───────────────────────────

function assertHashingScheme(v: string): CantonHashingSchemeVersion {
  if (v !== 'HASHING_SCHEME_VERSION_V2') {
    throw new Error(
      `LedgerApiAdapter: unsupported hashing scheme ${v}; kernel only knows V2 ` +
        `(see DESIGN.md §11 open question #4)`,
    );
  }
  return 'HASHING_SCHEME_VERSION_V2';
}

/**
 * Parse a Canton timestamp. The Scan API returns ISO-8601 strings; some
 * validator-app endpoints emit epoch microseconds as decimal strings. This
 * normalises both to Unix milliseconds.
 */
function parseTimestamp(s: string): number {
  if (/^\d+$/.test(s)) {
    // Epoch microseconds → milliseconds.
    return Math.floor(Number(s) / 1000);
  }
  return Date.parse(s);
}

function isHttpStatus(e: unknown, status: number): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'status' in e &&
    (e as { status: unknown }).status === status
  );
}
