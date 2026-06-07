/**
 * TrainingPort — Tenzro Train protocol surface.
 *
 * Tenzro Train splits cleanly into two layers — a Rust protocol layer
 * (syncers, aggregation, witness committees, receipts) and a Python
 * reference trainer for the inner training loop. The wallet port
 * exposes the protocol layer's read + write RPCs so a wallet can:
 *
 *   - Inspect active runs and sealed receipts for runs the user
 *     sponsors or participates in.
 *   - Sign training task posts ("I authorize spending X TNZO to
 *     sponsor this run with this aggregator config") as a regular
 *     payment-class action.
 *   - Enroll the wallet's identity as a trainer DID into a run,
 *     including Confidential-tier enrollments that bind a TEE
 *     attestation to the sealed-shard manifest.
 *   - Surface sealed-shard manifests for inspection (Confidential
 *     tier) — the wallet never sees the plaintext shards, only the
 *     HPKE-wrapped envelopes and enclave measurements.
 *
 * Phase 4 (Confidential-tier sealed-shard pipelines) is fully wired
 * through this port; see `ConfidentialEnrollment` for the
 * attestation-binding shape.
 */

export type TrainingRunStatus =
  | 'Pending'
  | 'Active'
  | 'Completed'
  | 'Failed'
  | 'Cancelled';

export interface TrainingRun {
  readonly task_id: string;
  readonly task_spec: unknown;
  readonly status: TrainingRunStatus;
  readonly current_round: number;
  readonly state_root: string;
  readonly enrolled_trainers: readonly string[];
  readonly created_at_ms: number;
  readonly updated_at_ms: number;
  readonly receipt?: unknown;
  readonly metadata?: Record<string, unknown>;
}

export interface TrainingReceipt {
  readonly task_id: string;
  readonly final_state_root: string;
  readonly rounds_completed: number;
  readonly witness_committees: readonly unknown[];
  readonly manifest_hash?: string;
  readonly sealed_at_ms: number;
}

export interface SealedShardEnvelope {
  readonly trainer_did: string;
  readonly shard_index: number;
  readonly shard_ciphertext_hash: string;
  readonly shard_ciphertext_bytes: number;
  readonly wrapped_data_key: string;
  /** Always `"hpke-x25519-hkdf-sha256-aes-256-gcm"`. */
  readonly wrap_alg: string;
  readonly enclave_pubkey: string;
  readonly enclave_measurements_hex: string;
  readonly created_at_ms: number;
}

export interface SealedDatasetManifest {
  readonly task_id: string;
  readonly manifest_hash: string;
  readonly envelopes: readonly SealedShardEnvelope[];
  readonly created_at_ms: number;
}

/**
 * Confidential-tier enrollment payload — required when enrolling
 * into a task that has a sealed-shard manifest installed. The
 * attestation proves the trainer is running inside a TEE enclave
 * whose pubkey + measurements were sealed into the manifest.
 */
export interface ConfidentialEnrollment {
  readonly attestation: string;
  readonly enclave_pubkey: string;
  readonly measurements_hex: string;
}

export interface TrainingPort {
  // ── Read side ──
  listRuns(): Promise<{ runs: readonly TrainingRun[] }>;
  getRun(taskId: string): Promise<TrainingRun>;
  getReceipt(taskId: string): Promise<TrainingReceipt | null>;
  getSealedManifest(taskId: string): Promise<SealedDatasetManifest | null>;

  // ── Write side ──
  postTask(taskSpec: unknown): Promise<{ task_id: string }>;
  enrollTrainer(
    taskId: string,
    trainerDid: string,
    confidential?: ConfidentialEnrollment,
  ): Promise<unknown>;
  submitOuterGradient(taskId: string, gradient: unknown): Promise<unknown>;
  finalizeRound(taskId: string, syncRound: unknown): Promise<unknown>;
  installSealedManifest(
    taskId: string,
    manifest: SealedDatasetManifest,
  ): Promise<unknown>;
}
