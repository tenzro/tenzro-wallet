/**
 * WalletKernel — the facade. Wires identity, custody, surfaces, router, and
 * consent. UI/SDK consumers only ever touch this class.
 */

import { type BalanceProvider, aggregateBalances } from './balance/index.ts';
import { type PolicyContext, enforcePolicy } from './consent/index.ts';
import type {
  AcpPort,
  AgentPaymentPort,
  Ap2Port,
  AuthApprovalPort,
  Erc7802Port,
  Erc8004Port,
  EscrowPort,
  HtlcEscrowPort,
  NanopaymentPort,
  PaymentRailsPort,
  SessionKeyPort,
  TeeAttestationPort,
} from './ports/agent/index.ts';
import type { BridgeAdapterId, BridgeRoutePort } from './ports/bridge/index.ts';
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
  readonly ap2?: Ap2Port;
  readonly erc8004?: Erc8004Port;
  readonly agentPayment?: AgentPaymentPort;
  readonly nanopayment?: NanopaymentPort;
  /** Human-in-the-loop pending-approvals queue (auth engine). */
  readonly authApproval?: AuthApprovalPort;
  /** TEE attestation verification for the node's hybrid-signing co-signer. */
  readonly teeAttestation?: TeeAttestationPort;
  /** Scoped delegations (substrate for AP2 / Mastercard / x402 caps). */
  readonly sessionKey?: SessionKeyPort;
  /** Native escrow primitive (CreateEscrow/Release/Refund). */
  readonly escrow?: EscrowPort;
  /** Payment rails (MPP / x402 / AP2 / Visa TAP / Mastercard) settlement. */
  readonly paymentRails?: PaymentRailsPort;
  /** OpenAI ACP (Agentic Commerce Protocol) buyer-side. SDK adapter pending. */
  readonly acp?: AcpPort;
  /** HTLC cross-chain escrow (v2 — DESIGN.md §11.7). SDK adapter pending. */
  readonly htlcEscrow?: HtlcEscrowPort;
  /** ERC-7802 SuperchainERC20 cross-chain mint/burn calldata encoder. */
  readonly erc7802?: Erc7802Port;
}

export interface WalletKernelOptions {
  readonly identity: TdipIdentity;
  readonly surfaces: ReadonlyMap<SurfaceName, SurfaceModule>;
  readonly balanceProviders?: readonly BalanceProvider[];
  /** Identity-level delegation scope, set by the user. */
  readonly delegationScope?: SpendingPolicy;
  /** Per-session policy, set when a session is opened. */
  readonly sessionPolicy?: SpendingPolicy;
  /** Optional agent-payment ports (AP2, ERC-8004, agent-payment, nano).
   *  When omitted, `kernel.agent.<port>` accessors throw. */
  readonly agentPorts?: AgentPortsBundle;
  /** Optional bridge router adapters (LI.FI / CCIP / LayerZero), keyed by
   *  `adapterId`. Consumers query each for a quote and pick the winner;
   *  the kernel never picks for them. Empty by default; M8 work. */
  readonly bridgeAdapters?: ReadonlyArray<BridgeRoutePort>;
}

export class WalletKernel {
  readonly identity: TdipIdentity;
  readonly #surfaces: ReadonlyMap<SurfaceName, SurfaceModule>;
  readonly #balanceProviders: readonly BalanceProvider[];
  readonly #delegationScope: SpendingPolicy | undefined;
  readonly #sessionPolicy: SpendingPolicy | undefined;
  readonly #agentPorts: AgentPortsBundle;
  readonly #bridgeAdapters: ReadonlyMap<BridgeAdapterId, BridgeRoutePort>;
  #spentToday = 0n;

  constructor(opts: WalletKernelOptions) {
    this.identity = opts.identity;
    this.#surfaces = opts.surfaces;
    this.#balanceProviders = opts.balanceProviders ?? [];
    this.#delegationScope = opts.delegationScope;
    this.#sessionPolicy = opts.sessionPolicy;
    this.#agentPorts = opts.agentPorts ?? {};
    this.#bridgeAdapters = new Map((opts.bridgeAdapters ?? []).map((a) => [a.adapterId, a]));
  }

  /**
   * Bridge router accessors. Consumers fan out across all registered
   * adapters for `quote()` (cheapest/fastest pick is theirs to make),
   * then call `build()`/`track()` on the chosen adapter.
   */
  readonly bridge = {
    /** All registered adapters, in registration order. */
    adapters: (): readonly BridgeRoutePort[] => Array.from(this.#bridgeAdapters.values()),
    /** Look up a single adapter by `adapterId`. */
    get: (id: BridgeAdapterId): BridgeRoutePort | undefined => this.#bridgeAdapters.get(id),
  } as const;

  /**
   * Agent-payment ports — AP2 (mandate verification + session lifecycle),
   * ERC-8004 (agent registry calldata), agent-payment (spending policy +
   * payForService), nanopayment (per-token streaming channels). Each
   * accessor throws if the port wasn't configured at construction time.
   */
  readonly agent = {
    ap2: (): Ap2Port => this.#requireAgent('ap2'),
    erc8004: (): Erc8004Port => this.#requireAgent('erc8004'),
    agentPayment: (): AgentPaymentPort => this.#requireAgent('agentPayment'),
    nanopayment: (): NanopaymentPort => this.#requireAgent('nanopayment'),
    authApproval: (): AuthApprovalPort => this.#requireAgent('authApproval'),
    teeAttestation: (): TeeAttestationPort => this.#requireAgent('teeAttestation'),
    sessionKey: (): SessionKeyPort => this.#requireAgent('sessionKey'),
    escrow: (): EscrowPort => this.#requireAgent('escrow'),
    paymentRails: (): PaymentRailsPort => this.#requireAgent('paymentRails'),
    acp: (): AcpPort => this.#requireAgent('acp'),
    htlcEscrow: (): HtlcEscrowPort => this.#requireAgent('htlcEscrow'),
    erc7802: (): Erc7802Port => this.#requireAgent('erc7802'),
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
