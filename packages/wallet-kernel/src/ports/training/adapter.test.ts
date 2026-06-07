import { describe, expect, it } from 'vitest';
import {
  TrainingAdapter,
  TrainingReadOnlyError,
  type TrainingInspectionClientLike,
  type TrainingWriteClientLike,
} from './adapter.ts';

function fakeClients(): {
  read: TrainingInspectionClientLike;
  write: TrainingWriteClientLike;
  calls: Array<[string, unknown[]]>;
} {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string) => async (...args: unknown[]) => {
    calls.push([name, args]);
    return { ok: true, method: name } as never;
  };
  const read = {
    listRuns: record('listRuns'),
    getRun: record('getRun'),
    getReceipt: record('getReceipt'),
    getSealedManifest: record('getSealedManifest'),
  } as unknown as TrainingInspectionClientLike;
  const write = {
    postTask: record('postTask'),
    enrollTrainer: record('enrollTrainer'),
    submitOuterGradient: record('submitOuterGradient'),
    finalizeRound: record('finalizeRound'),
    installSealedManifest: record('installSealedManifest'),
  } as unknown as TrainingWriteClientLike;
  return { read, write, calls };
}

describe('TrainingAdapter', () => {
  it('forwards read + write calls when both clients are provided', async () => {
    const { read, write, calls } = fakeClients();
    const adapter = new TrainingAdapter(read, write);

    await adapter.listRuns();
    await adapter.getRun('task-1');
    await adapter.getReceipt('task-1');
    await adapter.getSealedManifest('task-1');
    await adapter.postTask({ tier: 'Confidential' });
    await adapter.enrollTrainer('task-1', 'did:tenzro:machine:trainer');
    await adapter.enrollTrainer('task-1', 'did:tenzro:machine:trainer', {
      attestation: '0xatt',
      enclave_pubkey: '0xpk',
      measurements_hex: '0xmeas',
    });
    await adapter.submitOuterGradient('task-1', { round: 0 });
    await adapter.finalizeRound('task-1', { round: 0, state_root: '0xroot' });
    await adapter.installSealedManifest('task-1', {
      task_id: 'task-1',
      manifest_hash: '0xmh',
      envelopes: [],
      created_at_ms: 1,
    });

    expect(calls.map(([m]) => m)).toEqual([
      'listRuns',
      'getRun',
      'getReceipt',
      'getSealedManifest',
      'postTask',
      'enrollTrainer',
      'enrollTrainer',
      'submitOuterGradient',
      'finalizeRound',
      'installSealedManifest',
    ]);
  });

  it('throws TrainingReadOnlyError on write methods when constructed read-only', async () => {
    const { read } = fakeClients();
    const adapter = new TrainingAdapter(read);

    // The adapter throws synchronously from async-returning methods
    // (the error is raised before the Promise is constructed), so we
    // wrap each call in `() => …` and use the non-async expect form.
    expect(() => adapter.postTask({})).toThrow(TrainingReadOnlyError);
    expect(() =>
      adapter.enrollTrainer('task-1', 'did:tenzro:machine:trainer'),
    ).toThrow(TrainingReadOnlyError);
    expect(() => adapter.submitOuterGradient('task-1', {})).toThrow(
      TrainingReadOnlyError,
    );
    expect(() => adapter.finalizeRound('task-1', {})).toThrow(
      TrainingReadOnlyError,
    );
    expect(() =>
      adapter.installSealedManifest('task-1', {
        task_id: 'task-1',
        manifest_hash: '0xmh',
        envelopes: [],
        created_at_ms: 1,
      }),
    ).toThrow(TrainingReadOnlyError);

    // Read calls still work
    await expect(adapter.listRuns()).resolves.toBeTruthy();
  });
});
