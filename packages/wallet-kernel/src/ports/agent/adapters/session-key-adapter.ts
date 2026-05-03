/**
 * SessionKeySdkAdapter — wraps `AuthClient` so the wallet can express
 * "create / list / revoke scoped session keys" on top of the engine's
 * delegated-agent + JWT-revocation primitives.
 *
 * Wire mapping:
 *   create  → AuthClient.onboardDelegatedAgent(controllerDid, capabilities,
 *               delegationScope, dpopJkt?)
 *   list    → AuthClient.listSessions(controllerDid)            (if SDK
 *               exposes it; falls back to throwing 'unsupported' if not)
 *   revoke  → AuthClient.revokeJwt(jti) | AuthClient.revokeDid(did)
 *
 * Engine status fields are normalised. Optional fields use conditional
 * spread so callers under `exactOptionalPropertyTypes` get clean shapes.
 */

import type { AuthClient } from 'tenzro-sdk';
import type {
  ActiveSession,
  CreateSessionRequest,
  CreatedSession,
  RevokeSessionRequest,
  RevokeSessionResult,
  SessionKeyPort,
} from '../session-key.ts';

/**
 * Slice of `AuthClient` the adapter relies on, anchored to the SDK's real
 * shape via `Pick<>`. `listSessions` is structural-extra: the v1 SDK does
 * not expose it, but engines may, and the adapter detects-via-presence.
 */
export type SessionKeyClientLike = Pick<
  AuthClient,
  'onboardDelegatedAgent' | 'revokeJwt' | 'revokeDid'
> & {
  /** Optional — present on richer engines, absent on the v1 SDK. */
  listSessions?(controllerDid: string): Promise<{
    sessions?: Array<{
      agent_did?: string;
      did?: string;
      controller_did?: string;
      capabilities?: string[];
      delegation_scope?: Record<string, unknown>;
      issued_at?: number;
      expires_at?: number;
      status?: string;
    }>;
  }>;
};

export class SessionKeySdkAdapter implements SessionKeyPort {
  constructor(private readonly client: SessionKeyClientLike) {}

  async create(req: CreateSessionRequest): Promise<CreatedSession> {
    const raw = await this.client.onboardDelegatedAgent(
      req.controllerDid,
      [...req.scope.capabilities],
      req.scope.delegationScope,
      req.scope.dpopJkt,
    );
    // SDK's `identity` is typed `unknown` because the engine's TDIP record
    // is opaque to the SDK; we know the engine includes a `did` field.
    const idRecord = raw.identity as { did?: string; agent_did?: string } | null;
    const agentDid = idRecord?.agent_did ?? idRecord?.did ?? '';
    const accessToken = raw.access_token ?? '';
    const expiresAt =
      typeof raw.expires_in === 'number'
        ? Date.now() + raw.expires_in * 1000
        : 0;
    return {
      agentDid,
      accessToken,
      ...(raw.refresh_token !== undefined ? { refreshToken: raw.refresh_token } : {}),
      expiresAt,
    };
  }

  async list(controllerDid: string): Promise<readonly ActiveSession[]> {
    if (!this.client.listSessions) {
      // Engine doesn't expose a list endpoint yet. Surface this loudly so
      // the host app falls back to its own JWT inventory rather than
      // silently returning [].
      throw new Error(
        'SessionKey.list: engine does not implement listSessions; ' +
          'track session jtis client-side and revoke by jti.',
      );
    }
    const raw = await this.client.listSessions(controllerDid);
    const out: ActiveSession[] = [];
    for (const s of raw.sessions ?? []) {
      out.push({
        agentDid: s.agent_did ?? s.did ?? '',
        controllerDid: s.controller_did ?? controllerDid,
        capabilities: s.capabilities ?? [],
        delegationScope: s.delegation_scope ?? {},
        issuedAt: s.issued_at ?? 0,
        expiresAt: s.expires_at ?? 0,
        status: normaliseStatus(s.status),
      });
    }
    return out;
  }

  async revoke(req: RevokeSessionRequest): Promise<RevokeSessionResult> {
    if (req.target.kind === 'jti') {
      const r = await this.client.revokeJwt(req.target.jti, req.reason);
      return { target: req.target.jti, status: r.status ?? 'Revoked' };
    }
    const r = await this.client.revokeDid(req.target.did, req.reason);
    return { target: req.target.did, status: r.status ?? 'Revoked' };
  }
}

function normaliseStatus(raw: string | undefined): ActiveSession['status'] {
  switch ((raw ?? '').toLowerCase()) {
    case 'active':
      return 'active';
    case 'revoked':
      return 'revoked';
    case 'expired':
      return 'expired';
    default:
      return 'active';
  }
}
