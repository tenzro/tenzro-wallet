/**
 * FrostHttpAdapter — fetch-based driver against a Tenzro RPC node's
 * `/wallet/frost/{ed25519,secp256k1}/*` endpoints. Implements the
 * `FrostCoordinator` port; mirrors `PairingHttpAdapter` for shape.
 *
 * Wire shape per `coordinator.ts` header + DESIGN.md §10.2:
 *
 *   POST /wallet/frost/{ed25519|secp256k1}/start
 *     body  = { did, surface_key, scheme, preimage_b64, purpose? }
 *     reply = { session_id, expires_at, participants[] }
 *
 *   POST /wallet/frost/{ed25519|secp256k1}/commit
 *     body  = { session_id, device_commitment_b64 }
 *     reply = { session_id, state }
 *
 *   POST /wallet/frost/{ed25519|secp256k1}/await-challenge
 *     body  = { session_id }            (long-poll)
 *     reply = { session_id, state, group_commitment_b64,
 *               signer_set[], lambda_b64 }
 *
 *   POST /wallet/frost/{ed25519|secp256k1}/respond
 *     body  = { session_id, device_share_b64 }
 *     reply = { session_id, state }
 *
 *   POST /wallet/frost/{ed25519|secp256k1}/finalize
 *     body  = { session_id }
 *     reply = { session_id, state, signature_b64? }
 *
 *   POST /wallet/frost/{ed25519|secp256k1}/abort
 *     body  = { session_id, reason? }
 *     reply = 204 No Content (idempotent)
 *
 * Bytes on the wire are standard base64 (RFC 4648 §4) — same convention
 * the Canton ledger HTTP layer uses. The `_b64` suffix on field names is
 * load-bearing: it tells reviewers and the node what to expect without
 * having to read the schema. Decoding/encoding happens at this boundary
 * only; the port surface is `Uint8Array`.
 *
 * The `/wallet/*` endpoints are pre-auth: the FROST round itself is
 * authenticated by the device share + node-TEE quorum, not by an
 * `Authorization` header. Auth on `/wallet/frost/start` is by the
 * caller's session (DPoP-bound bearer for M2-style sessions, passkey
 * assertion for M5). Threading that auth is the host app's job — the
 * adapter accepts an optional `headers` callback for it.
 *
 * Browser-clean: `fetch` only. No Node-specific globals.
 */

import type {
  FrostChallenge,
  FrostCommitRequest,
  FrostCommitResult,
  FrostCoordinator,
  FrostFinalizeResult,
  FrostParticipantId,
  FrostRespondRequest,
  FrostRespondResult,
  FrostScheme,
  FrostSessionState,
  FrostStartRequest,
  FrostStartResult,
} from './coordinator.ts';

export interface FrostHttpConfig {
  /** Base URL of the Tenzro RPC node, e.g. `https://rpc.tenzro.xyz`. */
  readonly baseUrl: string;
  /** Optional `fetch` override for tests. */
  readonly fetch?: typeof fetch;
  /**
   * Per-request headers (e.g. `{ Authorization: 'DPoP …', DPoP: '…' }`).
   * Called for every request — let the host rotate proofs as needed.
   * Returning `{}` is fine; the adapter always sets `content-type`.
   */
  readonly headers?: () => Promise<Record<string, string>> | Record<string, string>;
}

export class FrostHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`frost http ${status} on ${url}: ${body.length > 200 ? body.slice(0, 200) + '…' : body}`);
    this.name = 'FrostHttpError';
  }
}

interface RawSession {
  session_id: string;
  state: FrostSessionState;
}
interface RawStart {
  session_id: string;
  expires_at: number;
  participants: FrostParticipantId[];
}
interface RawChallenge extends RawSession {
  group_commitment_b64: string;
  signer_set: FrostParticipantId[];
  lambda_b64: string;
}
interface RawFinalize extends RawSession {
  signature_b64?: string;
}

export class FrostHttpAdapter implements FrostCoordinator {
  readonly #cfg: FrostHttpConfig;
  /** Pinned at `start()` so subsequent calls hit the right curve path. */
  #scheme: FrostScheme | undefined;

  constructor(cfg: FrostHttpConfig) {
    this.#cfg = cfg;
  }

  async start(req: FrostStartRequest): Promise<FrostStartResult> {
    this.#scheme = req.scheme;
    const raw = await this.#post<RawStart>('start', {
      did: req.did,
      surface_key: req.surfaceKey,
      scheme: req.scheme,
      preimage_b64: bytesToBase64(req.preimage),
      ...(req.purpose !== undefined ? { purpose: req.purpose } : {}),
    });
    return {
      sessionId: raw.session_id,
      expiresAt: raw.expires_at,
      participants: raw.participants,
    };
  }

  async commit(req: FrostCommitRequest): Promise<FrostCommitResult> {
    const raw = await this.#post<RawSession>('commit', {
      session_id: req.sessionId,
      device_commitment_b64: bytesToBase64(req.deviceCommitment),
    });
    return { sessionId: raw.session_id, state: raw.state };
  }

  async awaitChallenge(sessionId: string): Promise<FrostChallenge> {
    const raw = await this.#post<RawChallenge>('await-challenge', {
      session_id: sessionId,
    });
    return {
      sessionId: raw.session_id,
      state: raw.state,
      groupCommitment: base64ToBytes(raw.group_commitment_b64),
      signerSet: raw.signer_set,
      lambda: base64ToBytes(raw.lambda_b64),
    };
  }

  async respond(req: FrostRespondRequest): Promise<FrostRespondResult> {
    const raw = await this.#post<RawSession>('respond', {
      session_id: req.sessionId,
      device_share_b64: bytesToBase64(req.deviceShare),
    });
    return { sessionId: raw.session_id, state: raw.state };
  }

  async finalize(sessionId: string): Promise<FrostFinalizeResult> {
    const raw = await this.#post<RawFinalize>('finalize', {
      session_id: sessionId,
    });
    return {
      sessionId: raw.session_id,
      state: raw.state,
      ...(raw.signature_b64 !== undefined ? { signature: base64ToBytes(raw.signature_b64) } : {}),
    };
  }

  async abort(sessionId: string, reason?: string): Promise<void> {
    await this.#post<unknown>('abort', {
      session_id: sessionId,
      ...(reason !== undefined ? { reason } : {}),
    });
  }

  // --- internals ---

  /**
   * The curve segment of the path is selected by the scheme pinned at
   * `start()`. Calling any other method before `start()` is a programmer
   * error — the FROST drivers always start before commit/respond.
   */
  async #post<TRes>(action: string, body: unknown): Promise<TRes> {
    if (!this.#scheme) {
      throw new Error(`FrostHttpAdapter: cannot call ${action} before start() pins the scheme`);
    }
    const f = this.#cfg.fetch ?? globalThis.fetch;
    const url = this.#cfg.baseUrl.replace(/\/+$/, '') + `/wallet/frost/${this.#scheme}/${action}`;
    const extraHeaders = this.#cfg.headers ? await this.#cfg.headers() : {};
    const res = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new FrostHttpError(res.status, url, text);
    }
    if (res.status === 204) return undefined as TRes;
    return (await res.json()) as TRes;
  }
}

// ─── base64 helpers ───────────────────────────────────────────────────────
// Local to this file (matches the htlc-escrow-adapter pattern). Standard
// base64, not base64url — the Tenzro RPC layer uses the same encoding the
// Canton JSON Ledger API does.

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
