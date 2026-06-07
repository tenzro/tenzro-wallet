/**
 * WorkflowAdapter — `WorkflowPort` backed by `tenzro-sdk`
 * `WorkflowClient`. Only file in the kernel allowed to import
 * `tenzro-sdk` for workflows.
 *
 * SDK shape this targets (`tenzro-sdk@^0.4.0`). The SDK exposes
 * `client.workflow.get(id)`; the wallet port renames it to
 * `getWorkflow(id)` to avoid collision with the other `getX` accessors.
 */

import type { WorkflowClient } from 'tenzro-sdk';
import type { WorkflowPort, WorkflowStatus } from './workflow.ts';

export type WorkflowClientLike = Pick<
  WorkflowClient,
  | 'open'
  | 'stepExecute'
  | 'stepVerify'
  | 'stepCompensate'
  | 'finalize'
  | 'get'
  | 'getSaga'
  | 'getLifecycle'
  | 'getReceipt'
  | 'getOperationalMetrics'
  | 'listReceipts'
  | 'listByCreator'
  | 'listByParticipant'
  | 'listByStatus'
  | 'mirrorToCanton'
  | 'verifyDidEnvelope'
>;

export class WorkflowAdapter implements WorkflowPort {
  constructor(private readonly client: WorkflowClientLike) {}

  open(workflow: unknown): Promise<unknown> {
    return this.client.open(workflow as never);
  }
  stepExecute(
    workflowId: string,
    stepId: string,
    escrowAmount?: bigint,
  ): Promise<unknown> {
    return this.client.stepExecute(workflowId, stepId, escrowAmount);
  }
  stepVerify(workflowId: string, stepId: string): Promise<unknown> {
    return this.client.stepVerify(workflowId, stepId);
  }
  stepCompensate(workflowId: string, stepId: string): Promise<unknown> {
    return this.client.stepCompensate(workflowId, stepId);
  }
  finalize(workflowId: string): Promise<unknown> {
    return this.client.finalize(workflowId);
  }
  getWorkflow(workflowId: string): Promise<unknown> {
    return this.client.get(workflowId);
  }
  getSaga(workflowId: string): Promise<unknown> {
    return this.client.getSaga(workflowId);
  }
  getLifecycle(workflowId: string): Promise<unknown> {
    return this.client.getLifecycle(workflowId);
  }
  getReceipt(workflowId: string): Promise<unknown> {
    return this.client.getReceipt(workflowId);
  }
  getOperationalMetrics(workflowId: string): Promise<unknown> {
    return this.client.getOperationalMetrics(workflowId);
  }
  listReceipts(limit?: number): Promise<unknown> {
    return this.client.listReceipts(limit);
  }
  listByCreator(creatorDid: string): Promise<unknown> {
    return this.client.listByCreator(creatorDid);
  }
  listByParticipant(participantDid: string): Promise<unknown> {
    return this.client.listByParticipant(participantDid);
  }
  listByStatus(status: WorkflowStatus): Promise<unknown> {
    return this.client.listByStatus(status as never);
  }
  mirrorToCanton(workflowId: string): Promise<unknown> {
    return this.client.mirrorToCanton(workflowId);
  }
  verifyDidEnvelope(envelope: unknown): Promise<unknown> {
    return this.client.verifyDidEnvelope(envelope as never);
  }
}
