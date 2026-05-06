/**
 * EscrowSdkAdapter — wraps `SettlementClient` so the kernel can drive the
 * native escrow primitive without owning the tx-shape encoding.
 *
 * Wire:
 *   create  → SettlementClient.createEscrow(payer, payee, amount, asset,
 *               expiresAt, releaseMode)
 *   release → SettlementClient.releaseEscrow(payer, escrowId, proof?)
 *   refund  → SettlementClient.refundEscrow(payer, escrowId)
 *   get     → SettlementClient.getEscrow(escrowId)
 *
 * The SDK already maps the release-mode enum string ('timeout' /
 * 'provider' / 'consumer' / 'both' / 'verifier' / 'custom') to the
 * `release_conditions` JSON the VM expects, so we just forward.
 */

import type { SettlementClient } from 'tenzro-sdk';
import type {
  CreateEscrowRequest,
  EscrowPort,
  EscrowRecord,
  EscrowReleaseMode,
  RefundEscrowRequest,
  ReleaseEscrowRequest,
} from '../escrow.ts';

/**
 * Slice of `SettlementClient` the adapter relies on, anchored to the SDK
 * via `Pick<>` so a method-rename in `tenzro-sdk` breaks the build.
 */
export type EscrowClientLike = Pick<
  SettlementClient,
  | 'createEscrow'
  | 'releaseEscrow'
  | 'refundEscrow'
  | 'getEscrow'
  | 'listEscrowsByPayer'
  | 'listEscrowsByPayee'
>;

interface RawEscrow {
  escrow_id?: string;
  id?: string;
  payer?: string;
  payee?: string;
  amount?: string | number;
  asset?: string;
  asset_id?: string;
  expires_at?: number;
  release_conditions?: { type?: string };
  release_mode?: string;
  status?: string;
}

export class EscrowSdkAdapter implements EscrowPort {
  constructor(private readonly client: EscrowClientLike) {}

  create(req: CreateEscrowRequest): Promise<string> {
    return this.client.createEscrow(
      req.payer,
      req.payee,
      req.amount,
      req.asset,
      req.expiresAt,
      req.releaseMode,
    );
  }

  release(req: ReleaseEscrowRequest): Promise<string> {
    return this.client.releaseEscrow(req.payer, req.escrowId, req.proof);
  }

  refund(req: RefundEscrowRequest): Promise<string> {
    return this.client.refundEscrow(req.payer, req.escrowId);
  }

  async get(escrowId: string): Promise<EscrowRecord | null> {
    const raw = (await this.client.getEscrow(escrowId)) as RawEscrow | null;
    return raw === null || raw === undefined ? null : decodeEscrow(raw);
  }

  async listByPayer(payer: string): Promise<EscrowRecord[]> {
    const raws = (await this.client.listEscrowsByPayer(payer)) as RawEscrow[] | null | undefined;
    return decodeEscrowList(raws);
  }

  async listByPayee(payee: string): Promise<EscrowRecord[]> {
    const raws = (await this.client.listEscrowsByPayee(payee)) as RawEscrow[] | null | undefined;
    return decodeEscrowList(raws);
  }
}

function decodeEscrowList(raws: RawEscrow[] | null | undefined): EscrowRecord[] {
  if (!Array.isArray(raws)) return [];
  const out: EscrowRecord[] = [];
  for (const raw of raws) {
    const rec = decodeEscrow(raw);
    if (rec !== null) out.push(rec);
  }
  return out;
}

function decodeEscrow(raw: RawEscrow): EscrowRecord | null {
  const id = raw.escrow_id ?? raw.id;
  if (id === undefined) return null;
  return {
    escrowId: id,
    payer: raw.payer ?? '',
    payee: raw.payee ?? '',
    amount: raw.amount !== undefined ? BigInt(raw.amount) : 0n,
    asset: raw.asset ?? raw.asset_id ?? 'TNZO',
    expiresAt: raw.expires_at ?? 0,
    releaseMode: normaliseMode(raw.release_conditions?.type ?? raw.release_mode),
    status: normaliseStatus(raw.status),
  };
}

function normaliseMode(raw: string | undefined): EscrowReleaseMode {
  switch ((raw ?? '').toLowerCase()) {
    case 'timeout':
      return 'timeout';
    case 'providersignature':
    case 'provider_signature':
    case 'provider':
      return 'provider';
    case 'consumersignature':
    case 'consumer_signature':
    case 'consumer':
      return 'consumer';
    case 'bothsignatures':
    case 'both_signatures':
    case 'both':
      return 'both';
    case 'verifiersignature':
    case 'verifier_signature':
    case 'verifier':
      return 'verifier';
    case 'custom':
      return 'custom';
    default:
      return 'timeout';
  }
}

function normaliseStatus(raw: string | undefined): EscrowRecord['status'] {
  switch ((raw ?? '').toLowerCase()) {
    case 'active':
      return 'active';
    case 'released':
      return 'released';
    case 'refunded':
      return 'refunded';
    case 'expired':
      return 'expired';
    default:
      return 'active';
  }
}
