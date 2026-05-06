/**
 * AuthApprovalSdkAdapter — wraps the SDK's `AuthClient` (the slice we
 * actually use: pending approvals + decide). Pending records are kept
 * opaque (the SDK declares them `unknown[]`); we cast each to the port's
 * `PendingApproval` record type without re-shaping.
 */

import type { AuthClient } from 'tenzro-sdk';
import type {
  ApprovalDecisionResult,
  ApprovalDecisionStatus,
  AuthApprovalPort,
  PendingApproval,
  PendingApprovalsList,
} from '../auth-approval.ts';

export interface AuthClientLike {
  listPendingApprovals(approverDid: string): Promise<{
    count?: number;
    pending?: unknown[];
  }>;
  decideApproval(
    approvalId: string,
    decision: 'approved' | 'denied',
    approverDid: string,
  ): Promise<{
    status?: string;
    approval_id?: string;
  }>;
}

export class AuthApprovalSdkAdapter implements AuthApprovalPort {
  constructor(private readonly client: AuthClientLike) {}

  static fromClient(client: AuthClient): AuthApprovalSdkAdapter {
    return new AuthApprovalSdkAdapter(client as unknown as AuthClientLike);
  }

  async listPending(approverDid: string): Promise<PendingApprovalsList> {
    const raw = await this.client.listPendingApprovals(approverDid);
    return {
      count: raw.count ?? raw.pending?.length ?? 0,
      pending: (raw.pending ?? []) as PendingApproval[],
    };
  }

  async decide(
    approvalId: string,
    decision: 'approved' | 'denied',
    approverDid: string,
  ): Promise<ApprovalDecisionResult> {
    const raw = await this.client.decideApproval(approvalId, decision, approverDid);
    // The engine returns status as a free-form string; we narrow to the
    // two values it actually emits, defaulting to the requested decision.
    const status: ApprovalDecisionStatus =
      raw.status === 'Approved' || raw.status === 'Denied'
        ? raw.status
        : decision === 'approved'
          ? 'Approved'
          : 'Denied';
    return {
      status,
      approvalId: raw.approval_id ?? approvalId,
    };
  }
}
