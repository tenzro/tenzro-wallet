/**
 * WorkflowPort — multi-party saga workflows with AP2 / x402 / MPP /
 * Stripe SPT / Visa TAP / Mastercard Agent Pay mandate binding.
 *
 * Wallet usage: the wallet does NOT coordinate workflows (that's a
 * separate orchestrator). It signs steps on behalf of the user/agent
 * via the configured custody, surfaces lifecycle/receipts in the UI,
 * and exposes optional Canton mirroring + DID-envelope verification.
 */

export type WorkflowStatus =
  | 'pending'
  | 'executing'
  | 'awaiting_signatures'
  | 'verified'
  | 'compensating'
  | 'finalized'
  | 'failed';

export interface WorkflowPort {
  open(workflow: unknown): Promise<unknown>;
  /**
   * Transition a saga step Pending → Executing. Pass `escrowAmount` (as
   * bigint, smallest unit) to lock a per-step escrow.
   */
  stepExecute(
    workflowId: string,
    stepId: string,
    escrowAmount?: bigint,
  ): Promise<unknown>;
  stepVerify(workflowId: string, stepId: string): Promise<unknown>;
  stepCompensate(workflowId: string, stepId: string): Promise<unknown>;
  finalize(workflowId: string): Promise<unknown>;
  getWorkflow(workflowId: string): Promise<unknown>;
  getSaga(workflowId: string): Promise<unknown>;
  getLifecycle(workflowId: string): Promise<unknown>;
  getReceipt(workflowId: string): Promise<unknown>;
  getOperationalMetrics(workflowId: string): Promise<unknown>;
  listReceipts(limit?: number): Promise<unknown>;
  listByCreator(creatorDid: string): Promise<unknown>;
  listByParticipant(participantDid: string): Promise<unknown>;
  listByStatus(status: WorkflowStatus): Promise<unknown>;
  mirrorToCanton(workflowId: string): Promise<unknown>;
  verifyDidEnvelope(envelope: unknown): Promise<unknown>;
}
