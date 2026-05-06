/**
 * InsuranceSdkAdapter — wraps `InsuranceClient` so the kernel can file
 * insurance claims and read pool state without owning the RPC params
 * shape.
 *
 * Wire:
 *   fileClaim    → InsuranceClient.fileInsuranceClaim(params)
 *   get          → InsuranceClient.getInsuranceClaim(claimId)
 *   list         → InsuranceClient.listInsuranceClaims()
 *   poolBalance  → InsuranceClient.getInsurancePoolBalance()
 *
 * The SDK's `fileInsuranceClaim` takes an opaque `Record<string,
 * unknown>` because the node-side params shape evolves with
 * governance — we serialise our typed `FileInsuranceClaimRequest` to
 * the snake_case keys the RPC expects.
 */

import type { InsuranceClient } from 'tenzro-sdk';
import type {
  ClaimStatus,
  FileInsuranceClaimRequest,
  InsuranceClaimRecord,
  InsurancePort,
} from '../insurance.ts';

/**
 * Slice of `InsuranceClient` the adapter relies on, anchored to the SDK
 * via `Pick<>` so a method-rename in `tenzro-sdk` breaks the build.
 */
export type InsuranceClientLike = Pick<
  InsuranceClient,
  'fileInsuranceClaim' | 'getInsuranceClaim' | 'listInsuranceClaims' | 'getInsurancePoolBalance'
>;

interface RawClaim {
  claim_id?: string;
  claimId?: string;
  claimant_did?: string;
  claimantDid?: string;
  claimant_address?: string;
  claimantAddress?: string;
  against_agent_did?: string;
  againstAgentDid?: string;
  amount_requested?: string | number;
  amountRequested?: string | number;
  receipt_refs?: string[];
  receiptRefs?: string[];
  narrative?: string | null;
  status?: string;
  governance_ref?: string | null;
  governanceRef?: string | null;
  paid_amount?: string | number | null;
  paidAmount?: string | number | null;
  filed_at?: number;
  filedAt?: number;
}

export class InsuranceSdkAdapter implements InsurancePort {
  constructor(private readonly client: InsuranceClientLike) {}

  async fileClaim(req: FileInsuranceClaimRequest): Promise<InsuranceClaimRecord> {
    const params: Record<string, unknown> = {
      claimant_did: req.claimantDid,
      claimant_address: req.claimantAddress,
      against_agent_did: req.againstAgentDid,
      amount_requested: req.amountRequested.toString(),
      receipt_refs: [...req.receiptRefs],
    };
    if (req.narrative !== undefined) {
      params.narrative = req.narrative;
    }
    const raw = (await this.client.fileInsuranceClaim(params)) as RawClaim;
    const decoded = decodeClaim(raw);
    if (decoded === null) {
      throw new Error('insurance.fileClaim: node returned a claim without claim_id');
    }
    return decoded;
  }

  async get(claimId: string): Promise<InsuranceClaimRecord | null> {
    const raw = (await this.client.getInsuranceClaim(claimId)) as RawClaim | null;
    return raw === null || raw === undefined ? null : decodeClaim(raw);
  }

  async list(): Promise<InsuranceClaimRecord[]> {
    const raws = (await this.client.listInsuranceClaims()) as RawClaim[] | null | undefined;
    if (!Array.isArray(raws)) return [];
    const out: InsuranceClaimRecord[] = [];
    for (const raw of raws) {
      const rec = decodeClaim(raw);
      if (rec !== null) out.push(rec);
    }
    return out;
  }

  async poolBalance(): Promise<bigint> {
    const raw = await this.client.getInsurancePoolBalance();
    return raw === undefined || raw === null ? 0n : BigInt(raw);
  }
}

function decodeClaim(raw: RawClaim): InsuranceClaimRecord | null {
  const claimId = raw.claim_id ?? raw.claimId;
  if (claimId === undefined) return null;
  const refs = raw.receipt_refs ?? raw.receiptRefs ?? [];
  const paidRaw = raw.paid_amount ?? raw.paidAmount;
  const govRef = raw.governance_ref ?? raw.governanceRef;
  const narrative = raw.narrative === null ? undefined : raw.narrative;
  const governanceRef = govRef === null ? undefined : govRef;
  const paidAmount = paidRaw === null || paidRaw === undefined ? undefined : BigInt(paidRaw);
  return {
    claimId,
    claimantDid: raw.claimant_did ?? raw.claimantDid ?? '',
    claimantAddress: raw.claimant_address ?? raw.claimantAddress ?? '',
    againstAgentDid: raw.against_agent_did ?? raw.againstAgentDid ?? '',
    amountRequested:
      raw.amount_requested !== undefined
        ? BigInt(raw.amount_requested)
        : raw.amountRequested !== undefined
          ? BigInt(raw.amountRequested)
          : 0n,
    receiptRefs: Object.freeze([...refs]),
    ...(narrative !== undefined ? { narrative } : {}),
    status: normaliseStatus(raw.status),
    ...(governanceRef !== undefined ? { governanceRef } : {}),
    ...(paidAmount !== undefined ? { paidAmount } : {}),
    filedAt: raw.filed_at ?? raw.filedAt ?? 0,
  };
}

function normaliseStatus(raw: string | undefined): ClaimStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'open':
      return 'open';
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'paid':
      return 'paid';
    default:
      return 'open';
  }
}
