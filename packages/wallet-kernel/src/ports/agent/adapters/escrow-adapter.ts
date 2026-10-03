/**
 * EscrowSdkAdapter — the native escrow primitive for the kernel.
 *
 * Writes are typed transactions the holder signs:
 *   create  → CreateEscrow { payee, amount, asset_id, usd_e6, expires_at, release_conditions }
 *   release → ReleaseEscrow { escrow_id, proof }
 *   refund  → RefundEscrow { escrow_id }
 * Reads go through `SettlementClient` (getEscrow, listEscrowsByPayer/Payee).
 */

import type { HybridSigner, SettlementClient } from 'tenzro-sdk';
import type {
  CreateEscrowRequest,
  EscrowPort,
  EscrowRecord,
  EscrowReleaseMode,
  RefundEscrowRequest,
  ReleaseEscrowRequest,
  ServiceProof,
} from '../escrow.ts';
import { type TypedTxSender, bytes, bytes32, txHash, u128 } from './typed-tx.ts';

/**
 * Slice of `SettlementClient` the adapter reads with, anchored to the SDK
 * via `Pick<>` so a method-rename in `tenzro-sdk` breaks the build.
 */
export type EscrowClientLike = Pick<
  SettlementClient,
  'getEscrow' | 'listEscrowsByPayer' | 'listEscrowsByPayee'
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

const CONDITIONS: Record<Exclude<EscrowReleaseMode, 'custom'>, string> = {
  timeout: 'Timeout',
  provider: 'ProviderSignature',
  consumer: 'ConsumerSignature',
  both: 'BothSignatures',
  verifier: 'VerifierSignature',
};

function releaseConditions(req: CreateEscrowRequest): unknown {
  if (req.releaseMode !== 'custom') return CONDITIONS[req.releaseMode];
  if (!req.customCondition) throw new Error('a custom release needs customCondition');
  return { Custom: { condition: req.customCondition } };
}

function serviceProof(p: ServiceProof): unknown {
  return {
    proof_type: p.proofType,
    proof_data: bytes(p.proofData, 'proof data'),
    signatures: (p.signatures ?? []).map((s) => ({
      signer: bytes32(s.signer, 'proof signer'),
      signature: bytes(s.signature, 'proof signature'),
      role: s.role,
    })),
    attestation: p.attestation === undefined ? null : bytes(p.attestation, 'attestation'),
  };
}

export class EscrowSdkAdapter implements EscrowPort {
  constructor(
    private readonly client: EscrowClientLike,
    private readonly tx: TypedTxSender,
    private readonly signer: HybridSigner,
  ) {}

  async create(req: CreateEscrowRequest): Promise<string> {
    if (req.asset !== 'TNZO' && req.usdE6 === undefined) {
      throw new Error(`an escrow in ${req.asset} needs its USD price (usdE6)`);
    }
    return txHash(
      await this.tx.send(this.signer, {
        kind: 'CreateEscrow',
        fields: {
          payee: bytes32(req.payee, 'payee'),
          amount: u128(req.amount, 'amount'),
          asset_id: req.asset,
          usd_e6: Number(req.usdE6 ?? 0n),
          expires_at: Number(req.expiresAt),
          release_conditions: releaseConditions(req),
        },
      }),
    );
  }

  async release(req: ReleaseEscrowRequest): Promise<string> {
    return txHash(
      await this.tx.send(this.signer, {
        kind: 'ReleaseEscrow',
        fields: { escrow_id: bytes32(req.escrowId, 'escrow id'), proof: serviceProof(req.proof) },
      }),
    );
  }

  async refund(req: RefundEscrowRequest): Promise<string> {
    return txHash(
      await this.tx.send(this.signer, {
        kind: 'RefundEscrow',
        fields: { escrow_id: bytes32(req.escrowId, 'escrow id') },
      }),
    );
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
