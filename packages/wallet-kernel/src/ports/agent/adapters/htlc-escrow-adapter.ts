/**
 * HtlcEscrowSdkAdapter — wraps `tenzro-sdk` `SettlementClient.{lockHtlc,
 * redeemHtlc, refundHtlc, getHtlc}` once they ship. Until then, calls
 * throw `"SDK pending — see DESIGN.md §11.7"` via detect-via-presence:
 * the adapter checks the corresponding method on the client at call
 * time, so an in-progress `tenzro-sdk` release that ships only some of
 * the four methods stays safe.
 *
 * Tenzro RPC endpoints (Tenzro implements; SDK proxies; kernel
 * consumes) — these are the v2 cross-chain HTLC primitive specified in
 * DESIGN.md §11.7. Method/path/wire shape locked here so the adapter
 * doesn't need to be re-shaped when the VM lands the tx_type:
 *
 *   1. `POST /v1/htlc/lock`
 *      Body: `{payer, payee, amount, asset, secret_hash_b64,
 *              expires_at_unix_ms, destination_corridor}`.
 *      Response: `{htlc_id, tx_hash, status}`.
 *
 *   2. `POST /v1/htlc/redeem`
 *      Body: `{htlc_id, secret_b64, proof}` where `proof` is corridor-
 *      shaped (Canton command-completion JSON, EVM event log, etc.).
 *      Response: `{tx_hash}`.
 *
 *   3. `POST /v1/htlc/refund`
 *      Body: `{htlc_id}`. The VM enforces the expiry check.
 *      Response: `{tx_hash}`.
 *
 *   4. `GET  /v1/htlc/{htlcId}`
 *      Response: `HtlcRecord` (snake_case wire form).
 *
 * Wire encoding of `secret_hash` and `secret`: base64 (RFC 4648 std,
 * with padding). The kernel converts to/from `Uint8Array` here so
 * surfaces and the SDK both stay simple.
 */

import type {
  HtlcEscrowPort,
  HtlcLockRequest,
  HtlcLockResult,
  HtlcRecord,
  HtlcRedeemRequest,
  HtlcRefundRequest,
  HtlcStatus,
} from '../htlc-escrow.ts';

export interface HtlcSdkClientLike {
  lockHtlc?(args: {
    readonly payer: string;
    readonly payee: string;
    readonly amount: bigint;
    readonly asset: string;
    readonly secretHashB64: string;
    readonly expiresAtUnixMs: number;
    readonly destinationCorridor: string;
  }): Promise<unknown>;
  redeemHtlc?(args: {
    readonly htlcId: string;
    readonly secretB64: string;
    readonly proof: Readonly<Record<string, unknown>>;
  }): Promise<unknown>;
  refundHtlc?(args: { readonly htlcId: string }): Promise<unknown>;
  getHtlc?(htlcId: string): Promise<unknown>;
}

interface RawLockResponse {
  htlc_id?: string;
  tx_hash?: string;
  status?: string;
}

interface RawRecord {
  htlc_id?: string;
  payer?: string;
  payee?: string;
  amount?: string | number;
  asset?: string;
  secret_hash_b64?: string;
  expires_at_unix_ms?: number;
  destination_corridor?: string;
  status?: string;
}

export class HtlcEscrowSdkAdapter implements HtlcEscrowPort {
  constructor(private readonly client: HtlcSdkClientLike) {}

  async lock(req: HtlcLockRequest): Promise<HtlcLockResult> {
    if (!this.client.lockHtlc) throw sdkPending('lockHtlc');
    const raw = (await this.client.lockHtlc({
      payer: req.payer,
      payee: req.payee,
      amount: req.amount,
      asset: req.asset,
      secretHashB64: bytesToBase64(req.secretHash),
      expiresAtUnixMs: req.expiresAt,
      destinationCorridor: req.destinationCorridor,
    })) as RawLockResponse;
    return {
      htlcId: raw.htlc_id ?? '',
      txHash: raw.tx_hash ?? '',
      status: normaliseStatus(raw.status),
    };
  }

  async redeem(req: HtlcRedeemRequest): Promise<{ readonly txHash: string }> {
    if (!this.client.redeemHtlc) throw sdkPending('redeemHtlc');
    const raw = (await this.client.redeemHtlc({
      htlcId: req.htlcId,
      secretB64: bytesToBase64(req.secret),
      proof: req.proof,
    })) as { tx_hash?: string };
    return { txHash: raw.tx_hash ?? '' };
  }

  async refund(req: HtlcRefundRequest): Promise<{ readonly txHash: string }> {
    if (!this.client.refundHtlc) throw sdkPending('refundHtlc');
    const raw = (await this.client.refundHtlc({ htlcId: req.htlcId })) as {
      tx_hash?: string;
    };
    return { txHash: raw.tx_hash ?? '' };
  }

  async get(htlcId: string): Promise<HtlcRecord | null> {
    if (!this.client.getHtlc) throw sdkPending('getHtlc');
    const raw = (await this.client.getHtlc(htlcId)) as RawRecord | null;
    if (raw === null || raw === undefined) return null;
    if (raw.htlc_id === undefined) return null;
    return {
      htlcId: raw.htlc_id,
      payer: raw.payer ?? '',
      payee: raw.payee ?? '',
      amount: raw.amount !== undefined ? BigInt(raw.amount) : 0n,
      asset: raw.asset ?? 'TNZO',
      secretHash: base64ToBytes(raw.secret_hash_b64 ?? ''),
      expiresAt: raw.expires_at_unix_ms ?? 0,
      destinationCorridor: raw.destination_corridor ?? '',
      status: normaliseStatus(raw.status),
    };
  }
}

function sdkPending(method: string): Error {
  return new Error(
    `SDK pending: tenzro-sdk SettlementClient.${method} not yet shipped — see DESIGN.md §11.7`,
  );
}

function normaliseStatus(raw: string | undefined): HtlcStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'locked':
      return 'locked';
    case 'redeemed':
      return 'redeemed';
    case 'refunded':
      return 'refunded';
    case 'expired':
      return 'expired';
    case 'timeout-pending':
    case 'timeout_pending':
      return 'timeout-pending';
    default:
      return 'locked';
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  // btoa is browser-clean; Node 16+ also has it on globalThis.
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  if (b64 === '') return new Uint8Array(0);
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
