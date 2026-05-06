/**
 * PairingHttpAdapter — fetch-based driver against a Tenzro RPC node's
 * `/wallet/pairing/*` endpoints. Browser-clean (fetch + JSON only).
 *
 * The `/wallet/*` endpoints are pre-auth: the QR pairing flow runs before
 * the new device has any session, and the originally-paired device's auth
 * is asserted by the passkey assertion in the body, not by an
 * `Authorization` header. So unlike the Canton HTTP helpers, no token
 * provider is threaded through.
 *
 * Wire shape per DESIGN.md §4.3.6:
 *   POST /wallet/pairing/start    → { session_id, pairing_url, expires_at }
 *   POST /wallet/pairing/claim    → { session_id, state }
 *   POST /wallet/pairing/poll     → { session_id, state, claimed_public_key?, reason? }
 *   POST /wallet/pairing/finalize → { session_id, verification_methods, threshold }
 *   POST /wallet/pairing/cancel   → 204 No Content
 */

import type {
  PairingClaimRequest,
  PairingClaimResult,
  PairingFinalizeRequest,
  PairingFinalizeResult,
  PairingPollResult,
  PairingPort,
  PairingStartRequest,
  PairingStartResult,
  PairingState,
  VerificationMethod,
} from './port.ts';

export interface PairingHttpConfig {
  /** Base URL of the Tenzro RPC node, e.g. `https://rpc.tenzro.network`. */
  readonly baseUrl: string;
  /** Optional `fetch` override for tests. */
  readonly fetch?: typeof fetch;
}

export class PairingHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(
      `pairing http ${status} on ${url}: ${body.length > 200 ? body.slice(0, 200) + '…' : body}`,
    );
    this.name = 'PairingHttpError';
  }
}

interface RawStart {
  session_id: string;
  pairing_url: string;
  expires_at: number;
}

interface RawState {
  session_id: string;
  state: PairingState;
  claimed_public_key?: string;
  reason?: string;
}

interface RawFinalize {
  session_id: string;
  verification_methods: Array<{
    id: string;
    type: string;
    controller: string;
    public_key_multibase: string;
  }>;
  threshold: string;
}

export class PairingHttpAdapter implements PairingPort {
  readonly #cfg: PairingHttpConfig;

  constructor(cfg: PairingHttpConfig) {
    this.#cfg = cfg;
  }

  async start(req: PairingStartRequest): Promise<PairingStartResult> {
    const raw = await this.#post<RawStart>('/wallet/pairing/start', {
      did: req.did,
      ...(req.label !== undefined ? { label: req.label } : {}),
    });
    return {
      sessionId: raw.session_id,
      pairingUrl: raw.pairing_url,
      expiresAt: raw.expires_at,
    };
  }

  async claim(req: PairingClaimRequest): Promise<PairingClaimResult> {
    const raw = await this.#post<{ session_id: string; state: PairingState }>(
      '/wallet/pairing/claim',
      {
        session_id: req.sessionId,
        new_device_public_key: req.newDevicePublicKey,
        assertion: {
          credential_id: req.assertion.credentialId,
          client_data_json: req.assertion.clientDataJson,
          authenticator_data: req.assertion.authenticatorData,
          signature: req.assertion.signature,
        },
      },
    );
    return { sessionId: raw.session_id, state: raw.state };
  }

  async poll(sessionId: string): Promise<PairingPollResult> {
    const raw = await this.#post<RawState>('/wallet/pairing/poll', {
      session_id: sessionId,
    });
    return {
      sessionId: raw.session_id,
      state: raw.state,
      ...(raw.claimed_public_key !== undefined ? { claimedPublicKey: raw.claimed_public_key } : {}),
      ...(raw.reason !== undefined ? { reason: raw.reason } : {}),
    };
  }

  async finalize(req: PairingFinalizeRequest): Promise<PairingFinalizeResult> {
    const raw = await this.#post<RawFinalize>('/wallet/pairing/finalize', {
      session_id: req.sessionId,
      original_device_assertion: {
        credential_id: req.originalDeviceAssertion.credentialId,
        client_data_json: req.originalDeviceAssertion.clientDataJson,
        authenticator_data: req.originalDeviceAssertion.authenticatorData,
        signature: req.originalDeviceAssertion.signature,
      },
    });
    const methods: VerificationMethod[] = raw.verification_methods.map((m) => ({
      id: m.id,
      type: m.type,
      controller: m.controller,
      publicKeyMultibase: m.public_key_multibase,
    }));
    return {
      sessionId: raw.session_id,
      verificationMethods: methods,
      threshold: raw.threshold,
    };
  }

  async cancel(sessionId: string): Promise<void> {
    await this.#post<unknown>('/wallet/pairing/cancel', { session_id: sessionId });
  }

  // --- internals ---

  async #post<TRes>(path: string, body: unknown): Promise<TRes> {
    const f = this.#cfg.fetch ?? globalThis.fetch;
    const url = this.#cfg.baseUrl.replace(/\/+$/, '') + path;
    const res = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new PairingHttpError(res.status, url, text);
    }
    if (res.status === 204) return undefined as TRes;
    return (await res.json()) as TRes;
  }
}
