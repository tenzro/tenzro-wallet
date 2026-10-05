/**
 * WalletKernel — the facade. Wires identity, custody, surfaces, router, and
 * consent. UI/SDK consumers only ever touch this class.
 */

import { type BalanceProvider, aggregateBalances } from './balance/index.ts';
import { type PolicyContext, enforcePolicy } from './consent/index.ts';
import type {
  AcpPort,
  AgentPaymentPort,
  EscrowPort,
  HtlcEscrowPort,
  TeeAttestationPort,
} from './ports/agent/index.ts';
import { selectRoute } from './router/index.ts';
import type { UnifiedBalance } from './types/asset.ts';
import type { Consent, SpendingPolicy } from './types/consent.ts';
import type { SurfaceKey, TdipDid, TdipIdentity } from './types/identity.ts';
import {
  type Intent,
  MEMO_SPEC_NONE,
  type MemoSpec,
  type PreparedTx,
  type SignedTx,
  type TxHandle,
  type TxStatus,
} from './types/intent.ts';
import type { SurfaceModule } from './types/surface-module.ts';
import type { SurfaceName } from './types/surface.ts';

/**
 * Optional bundle of agent-payment ports. None of these are surfaces in the
 * lifecycle sense (no prepare→sign→submit→watch); they're verification +
 * policy + session-management facades over Tenzro's RPC layer. ERC-8004
 * specifically returns calldata that surfaces (typically `evm-on-tenzro`)
 * sign and broadcast.
 *
 * Each field is independently optional so kernels can be assembled with
 * just AP2 (for verification gating), just ERC-8004 (for agent-identity
 * setup flows), etc.
 */
export interface AgentPortsBundle {
  readonly agentPayment?: AgentPaymentPort;
  /** TEE attestation verification for services that run in a provider's enclave. */
  readonly teeAttestation?: TeeAttestationPort;
  /** Native escrow primitive (CreateEscrow/Release/Refund). */
  readonly escrow?: EscrowPort;
  /** OpenAI ACP (Agentic Commerce Protocol) buyer-side. SDK adapter pending. */
  readonly acp?: AcpPort;
  /** HTLC cross-chain escrow (v2 — DESIGN.md §11.7). SDK adapter pending. */
  readonly htlcEscrow?: HtlcEscrowPort;
}

export interface WalletKernelOptions {
  readonly identity: TdipIdentity;
  readonly surfaces: ReadonlyMap<SurfaceName, SurfaceModule>;
  readonly balanceProviders?: readonly BalanceProvider[];
  /** Identity-level delegation scope, set by the user. */
  readonly delegationScope?: SpendingPolicy;
  /** Per-session policy, set when a session is opened. */
  readonly sessionPolicy?: SpendingPolicy;
  /** Optional agent ports. When omitted, `kernel.agent.<port>` accessors throw. */
  readonly agentPorts?: AgentPortsBundle;
}

export class WalletKernel {
  readonly identity: TdipIdentity;
  readonly #surfaces: ReadonlyMap<SurfaceName, SurfaceModule>;
  readonly #balanceProviders: readonly BalanceProvider[];
  readonly #delegationScope: SpendingPolicy | undefined;
  readonly #sessionPolicy: SpendingPolicy | undefined;
  readonly #agentPorts: AgentPortsBundle;
  #spentToday = 0n;

  constructor(opts: WalletKernelOptions) {
    this.identity = opts.identity;
    this.#surfaces = opts.surfaces;
    this.#balanceProviders = opts.balanceProviders ?? [];
    this.#delegationScope = opts.delegationScope;
    this.#sessionPolicy = opts.sessionPolicy;
    this.#agentPorts = opts.agentPorts ?? {};
  }

  /**
   * Agent ports. Each accessor throws if the port wasn't configured at
   * construction time.
   */
  readonly agent = {
    agentPayment: (): AgentPaymentPort => this.#requireAgent('agentPayment'),
    teeAttestation: (): TeeAttestationPort => this.#requireAgent('teeAttestation'),
    escrow: (): EscrowPort => this.#requireAgent('escrow'),
    acp: (): AcpPort => this.#requireAgent('acp'),
    htlcEscrow: (): HtlcEscrowPort => this.#requireAgent('htlcEscrow'),
  } as const;

  #requireAgent<K extends keyof AgentPortsBundle>(key: K): NonNullable<AgentPortsBundle[K]> {
    const port = this.#agentPorts[key];
    if (!port) {
      throw new Error(
        `agent port "${key}" not configured — pass it via WalletKernelOptions.agentPorts`,
      );
    }
    return port as NonNullable<AgentPortsBundle[K]>;
  }

  /** Resolve a surface key for a DID — the `keyResolver` surface modules call. */
  resolveKey(did: TdipDid, surface: SurfaceName): SurfaceKey | undefined {
    if (did !== this.identity.did) return undefined;
    return this.identity.keys.get(surface);
  }

  /** Aggregate balances across all registered providers. */
  async balances(): Promise<readonly UnifiedBalance[]> {
    return aggregateBalances(this.#balanceProviders);
  }

  /**
   * What memo / destination-tag shape does this intent need? Used by UIs to
   * render the right input field with the right validation. Surfaces that
   * never accept memos return `MEMO_SPEC_NONE`; surfaces that conditionally
   * require them (e.g. Canton transfers to certain exchange parties) return
   * a per-intent spec.
   */
  memoSpec(intent: Intent): MemoSpec {
    const sel = selectRoute(intent);
    const surface = this.#surfaceFor(sel.fromSurface);
    return surface.memoSpec?.(intent) ?? MEMO_SPEC_NONE;
  }

  /** First step: produce a Preview the user can confirm. */
  async prepare(intent: Intent): Promise<PreparedTx> {
    const sel = selectRoute(intent);
    const surface = this.#surfaceFor(sel.fromSurface);
    if (sel.route.kind === 'cross-vm-pointer') {
      if (!surface.preparePointer) {
        throw new Error(`surface ${surface.name} cannot source cross-VM pointer ops`);
      }
      if (intent.kind !== 'send') {
        throw new Error(`pointer ops only support send intents`);
      }
      return surface.preparePointer(intent, {
        fromSurface: sel.route.fromSurface,
        toSurface: sel.route.toSurface,
        owner: intent.from,
        amount: intent.amount,
      });
    }
    return surface.prepare(intent);
  }

  /** Second step: enforce policy, then sign. */
  async sign(prepared: PreparedTx, consent: Consent): Promise<SignedTx> {
    const ctx: PolicyContext = {
      ...(this.#delegationScope ? { delegationScope: this.#delegationScope } : {}),
      ...(this.#sessionPolicy ? { sessionPolicy: this.#sessionPolicy } : {}),
      spentSoFarToday: this.#spentToday,
    };
    enforcePolicy(prepared.intent, consent, ctx);
    const surface = this.#surfaceFor(
      prepared.route.kind === 'native'
        ? prepared.route.surface
        : (prepared.route as { fromSurface: SurfaceName }).fromSurface,
    );
    const signed = await surface.sign(prepared, consent);
    if (prepared.intent.kind === 'send') {
      this.#spentToday += prepared.intent.amount;
    }
    return signed;
  }

  /** Third step: submit. */
  async submit(signed: SignedTx): Promise<TxHandle> {
    const surfaceName =
      signed.prepared.route.kind === 'native'
        ? signed.prepared.route.surface
        : (signed.prepared.route as { fromSurface: SurfaceName }).fromSurface;
    const surface = this.#surfaceFor(surfaceName);
    return surface.submit(signed);
  }

  /** Fourth step: watch finality. */
  watch(handle: TxHandle): AsyncIterable<TxStatus> {
    return this.#surfaceFor(handle.surface).watch(handle);
  }

  // --- internals ---

  #surfaceFor(name: SurfaceName): SurfaceModule {
    const s = this.#surfaces.get(name);
    if (!s) throw new Error(`no surface registered for: ${name}`);
    return s;
  }
}
