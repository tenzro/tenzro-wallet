/**
 * PrincipalChainPort — read-only access to the receipt principal-chain
 * (Agent-Swarm Spec 5).
 *
 * Every settlement / payment / lifecycle receipt produced by the network
 * grows a typed `principal_chain` field captured at receipt write time:
 * a delegation path from the acting identity (`actor`) up to the
 * controller, plus the controller's KYC tier and bond figures. The
 * chain is frozen — later revocations don't invalidate it.
 *
 * Auditors, dashboards, and seed-agent governance walk these chains via
 * the SDK's `PrincipalChainClient`; the wallet exposes the same surface
 * so it can render "who paid for this" trails alongside transactions.
 */

export type PrincipalRole = 'controller' | 'delegated_agent' | 'autonomous_agent';

export type IdentityType = 'human' | 'machine';

export interface PrincipalLink {
  /** DID string of the link. */
  readonly did: string;
  readonly identityType: IdentityType;
  /** Hex-encoded SHA-256 of the DelegationScope under which this link acted. */
  readonly delegationScopeId?: string;
  readonly role: PrincipalRole;
  /**
   * `true` when the link's identity could not be resolved at receipt
   * write time (revoked, not-found). Receipts are still written — the
   * regulator sees a partially-resolvable chain with an explicit gap.
   */
  readonly tombstone: boolean;
}

export interface PrincipalChainRecord {
  /** DID of the acting identity (signer of the underlying tx). */
  readonly actor: string;
  /**
   * Top-down list of intermediate links. Empty when the controller acted
   * directly (`delegationDepth === 0`).
   */
  readonly chain: readonly PrincipalLink[];
  /** The controller link itself — the legally responsible principal. */
  readonly controller: PrincipalLink;
  /** 0 = Unverified, 1 = Basic, 2 = Enhanced, 3 = Full. */
  readonly controllerKycTier: number;
  /** Bond posted by the controller, in TNZO base units. */
  readonly controllerBond?: bigint;
  /** Bond posted directly against the actor's DID (Spec 9). */
  readonly actorBond?: bigint;
  /**
   * Sum of all promotion-eligible Active bonds the controller has posted
   * across every agent they own (Spec 9) — total skin-in-the-game.
   */
  readonly controllerBondAggregate?: bigint;
  /** Number of delegation levels between actor and controller. */
  readonly delegationDepth: number;
  /** Block height at which the chain was resolved and frozen. */
  readonly frozenAtBlock: bigint;
}

export interface PrincipalChainSummaryRecord {
  readonly actor: string;
  readonly controller: string;
  readonly controllerKycTier: number;
  readonly controllerBond?: bigint;
  readonly actorBond?: bigint;
  readonly controllerBondAggregate?: bigint;
  readonly delegationDepth: number;
  readonly hasTombstone: boolean;
  readonly frozenAtBlock: bigint;
}

export interface ControllerActivitySummaryRecord {
  readonly controllerDid: string;
  readonly receiptCount: bigint;
  /** Total settled value in the window, in TNZO base units. */
  readonly totalValueTnzo: bigint;
  /** Distinct DIDs that acted under the controller in the window. */
  readonly agentsActedUnder: readonly string[];
  readonly killSwitchEvents: number;
  readonly kycTierAtOldest: number;
  readonly kycTierAtNewest: number;
  readonly bondMin: bigint;
  readonly bondMax: bigint;
  /** Inclusive lower bound, unix seconds; undefined if open-ended. */
  readonly since?: number;
  /** Inclusive upper bound, unix seconds; undefined if open-ended. */
  readonly until?: number;
}

export interface PrincipalChainPort {
  /** Full chain for a single receipt. Returns null if unknown. */
  getReceiptPrincipalChain(receiptId: string): Promise<PrincipalChainRecord | null>;

  /** Compact summaries for every receipt with the given actor DID. */
  listReceiptsByActor(actorDid: string): Promise<PrincipalChainSummaryRecord[]>;

  /** Compact summaries for every receipt terminating at controllerDid. */
  listReceiptsByController(controllerDid: string): Promise<PrincipalChainSummaryRecord[]>;

  /** Aggregate activity metrics for a controller. Returns null if unknown. */
  summarizeController(controllerDid: string): Promise<ControllerActivitySummaryRecord | null>;
}
