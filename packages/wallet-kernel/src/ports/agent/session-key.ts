/**
 * SessionKeyPort — scoped delegations under TDIP.
 *
 * This is the primitive every agent-payment rail rests on. AP2 mandates,
 * Mastercard Agent Pay tokens, x402 micropayment caps, Visa TAP scopes —
 * all of them are *expressions* of a session key with a bounded
 * delegation scope. The wallet's job is to:
 *
 *   1. Create scoped session keys ("this agent may spend up to 10 USDC/day
 *      on inference services for the next hour").
 *   2. Inspect / list active scopes for the user UI.
 *   3. Revoke a scope when the user wants to cut off an agent.
 *
 * Server-side, the auth engine enforces. The wallet does NOT decide
 * whether a tx is in-policy — it asks. A compromised wallet client cannot
 * widen a scope; the engine rejects.
 *
 * Wire mapping: `tenzro_onboardDelegatedAgent`, `tenzro_revokeDid`,
 * `tenzro_revokeJwt` — i.e. delegation scopes are JWT-bound under the
 * controller's act-chain. Creating a scope is "onboard a delegated
 * agent under controllerDid with this scope"; revoking is revoking the
 * JWT (single scope) or the DID (cascades all scopes).
 *
 * The opaque `scope` shape is whatever the engine accepts — currently a
 * `Record<string, unknown>` matching `SpendingPolicy::is_allowed()`'s
 * input. The port doesn't validate; it forwards. AP2/Mastercard/Visa
 * adapters build scope objects that match their respective schemas and
 * pass them through.
 */

export interface SessionScope {
  /** Human-readable label shown in approver UI. */
  readonly label: string;
  /** Capability strings — "inference", "rpc-call", "storage", custom tags. */
  readonly capabilities: readonly string[];
  /** Engine-specific scope object. Forwarded as-is to the auth engine. */
  readonly delegationScope: Readonly<Record<string, unknown>>;
  /** Optional DPoP thumbprint to bind the resulting JWT to a specific key. */
  readonly dpopJkt?: string;
}

export interface CreateSessionRequest {
  /** Controller DID (the human or upstream agent granting authority). */
  readonly controllerDid: string;
  readonly scope: SessionScope;
}

export interface CreatedSession {
  /** DID of the newly-onboarded delegated agent. */
  readonly agentDid: string;
  /** Bearer JWT for the new agent. The wallet hands this to the agent. */
  readonly accessToken: string;
  /** Refresh token for renewal. */
  readonly refreshToken?: string;
  /** Unix-ms when the access token expires. */
  readonly expiresAt: number;
}

export interface ActiveSession {
  readonly agentDid: string;
  readonly controllerDid: string;
  readonly capabilities: readonly string[];
  readonly delegationScope: Readonly<Record<string, unknown>>;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly status: 'active' | 'revoked' | 'expired';
}

export interface RevokeSessionRequest {
  /**
   * Either a JWT `jti` (revokes a single session) or a DID (cascades
   * — invalidates every JWT minted under that DID and every descendant
   * DID in the act-chain).
   */
  readonly target: { kind: 'jti'; jti: string } | { kind: 'did'; did: string };
  readonly reason?: string;
}

export interface RevokeSessionResult {
  readonly target: string;
  readonly status: string;
}

export interface SessionKeyPort {
  /** Create a scoped session key under `controllerDid`. */
  create(req: CreateSessionRequest): Promise<CreatedSession>;

  /**
   * List active sessions for the controller. Used by the wallet UI to
   * render "agents acting on your behalf" + a revoke button.
   */
  list(controllerDid: string): Promise<readonly ActiveSession[]>;

  /** Revoke a single session (jti) or every session under a DID. */
  revoke(req: RevokeSessionRequest): Promise<RevokeSessionResult>;
}
