/**
 * AuthApprovalPort — human-in-the-loop approval queue.
 *
 * Tenzro's auth engine ships an approval workflow: when an agent (or
 * delegated session) initiates an action that exceeds its policy, the
 * engine parks the request in a `Pending` state and surfaces it to the
 * approver DID (typically a human controller). The approver fetches the
 * queue, decides each item, and the engine then either lets the action
 * through or rejects it.
 *
 * This port is what the wallet UI uses to render the approval inbox.
 * The wallet never makes the approve/deny decision itself — that's the
 * human's job — but the port makes the queue legible and lets the UI
 * commit the human's decision back to the engine.
 *
 * Wire-shape mapping ↔ `tenzro-sdk`'s `AuthClient.listPendingApprovals` /
 * `decideApproval`. The SDK keeps the per-record schema opaque (`unknown[]`)
 * because the underlying storage shape may evolve; the port mirrors that
 * conservatism — UIs can render whatever the engine returns without the
 * port locking the schema.
 */

/** A single pending-approval record. Schema kept opaque on purpose — see
 *  SDK `auth.ts`. UIs should narrow against known fields lazily. */
export type PendingApproval = Readonly<Record<string, unknown>>;

export interface PendingApprovalsList {
  readonly count: number;
  readonly pending: readonly PendingApproval[];
}

export type ApprovalDecisionStatus = 'Approved' | 'Denied';

export interface ApprovalDecisionResult {
  readonly status: ApprovalDecisionStatus;
  readonly approvalId: string;
}

export interface AuthApprovalPort {
  /** Pending records the approver should decide on. */
  listPending(approverDid: string): Promise<PendingApprovalsList>;

  /** Commit a human decision. Engine rejects mismatched approvers. */
  decide(
    approvalId: string,
    decision: 'approved' | 'denied',
    approverDid: string,
  ): Promise<ApprovalDecisionResult>;
}
