/**
 * TrainingAdapter — `TrainingPort` backed by `tenzro-sdk` clients.
 *
 * The SDK splits read and write into two classes for security
 * (`TrainingInspectionClient` is safe to expose to monitoring agents
 * that should never mutate state, while `TrainingClient` is the write
 * surface). The wallet's port unifies them — the host can construct
 * the adapter with either both, or just the read client when the
 * wallet is in read-only / dashboard mode.
 */

import type { TrainingClient, TrainingInspectionClient } from 'tenzro-sdk';
import type {
  ConfidentialEnrollment,
  SealedDatasetManifest,
  TrainingPort,
  TrainingReceipt,
  TrainingRun,
} from './training.ts';

export type TrainingInspectionClientLike = Pick<
  TrainingInspectionClient,
  'listRuns' | 'getRun' | 'getReceipt' | 'getSealedManifest'
>;

export type TrainingWriteClientLike = Pick<
  TrainingClient,
  | 'postTask'
  | 'enrollTrainer'
  | 'submitOuterGradient'
  | 'finalizeRound'
  | 'installSealedManifest'
>;

/**
 * Thrown when a write-side method is called on an adapter that was
 * constructed without a write client. Lets read-only hosts use the
 * same port type without paying for write-side wiring.
 */
export class TrainingReadOnlyError extends Error {
  constructor(method: string) {
    super(`TrainingAdapter is read-only: ${method} requires a TrainingClient`);
    this.name = 'TrainingReadOnlyError';
  }
}

export class TrainingAdapter implements TrainingPort {
  constructor(
    private readonly read: TrainingInspectionClientLike,
    private readonly write?: TrainingWriteClientLike,
  ) {}

  // ── Read side ──

  listRuns(): Promise<{ runs: readonly TrainingRun[] }> {
    return this.read.listRuns() as Promise<{ runs: readonly TrainingRun[] }>;
  }
  getRun(taskId: string): Promise<TrainingRun> {
    return this.read.getRun(taskId) as Promise<TrainingRun>;
  }
  getReceipt(taskId: string): Promise<TrainingReceipt | null> {
    return this.read.getReceipt(taskId) as Promise<TrainingReceipt | null>;
  }
  getSealedManifest(taskId: string): Promise<SealedDatasetManifest | null> {
    return this.read.getSealedManifest(taskId) as Promise<SealedDatasetManifest | null>;
  }

  // ── Write side ──

  postTask(taskSpec: unknown): Promise<{ task_id: string }> {
    if (!this.write) throw new TrainingReadOnlyError('postTask');
    return this.write.postTask(taskSpec) as Promise<{ task_id: string }>;
  }
  enrollTrainer(
    taskId: string,
    trainerDid: string,
    confidential?: ConfidentialEnrollment,
  ): Promise<unknown> {
    if (!this.write) throw new TrainingReadOnlyError('enrollTrainer');
    return this.write.enrollTrainer(taskId, trainerDid, confidential as never);
  }
  submitOuterGradient(taskId: string, gradient: unknown): Promise<unknown> {
    if (!this.write) throw new TrainingReadOnlyError('submitOuterGradient');
    return this.write.submitOuterGradient(taskId, gradient);
  }
  finalizeRound(taskId: string, syncRound: unknown): Promise<unknown> {
    if (!this.write) throw new TrainingReadOnlyError('finalizeRound');
    return this.write.finalizeRound(taskId, syncRound);
  }
  installSealedManifest(
    taskId: string,
    manifest: SealedDatasetManifest,
  ): Promise<unknown> {
    if (!this.write) throw new TrainingReadOnlyError('installSealedManifest');
    return this.write.installSealedManifest(taskId, manifest as never);
  }
}
