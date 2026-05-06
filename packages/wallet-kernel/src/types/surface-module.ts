/**
 * The Surface interface — every surface module implements exactly this.
 *
 * `prepare` is read-mostly: it can hit RPCs to estimate fees, check nonces, and
 * validate the recipient. It must never request user signing.
 *
 * `sign` is where the MPC quorum runs. Surface modules call into the
 * `SigningDriver` (passed at kernel construction) rather than holding key
 * material directly.
 *
 * `submit` is fire-and-forget; `watch` is the long-poll for finality.
 *
 * `preparePointer` is optional and lives on on-Tenzro surfaces only. Kernel
 * dispatches to it when route is `cross-vm-pointer` (precompile 0x1003 / SVM
 * cross-VM instruction / native syscall). Surfaces that can't be a pointer-op
 * source (canton-external) omit it; canton-internal lands its impl in M4.
 */

import type { CrossVmPointerOp } from '../ports/cross-vm.ts';
import type { Consent } from './consent.ts';
import type { Intent, MemoSpec, PreparedTx, SignedTx, TxHandle, TxStatus } from './intent.ts';
import type { SurfaceName } from './surface.ts';

export interface SurfaceModule {
  readonly name: SurfaceName;
  prepare(intent: Intent): Promise<PreparedTx>;
  preparePointer?(intent: Intent, op: CrossVmPointerOp): Promise<PreparedTx>;
  sign(prepared: PreparedTx, consent: Consent): Promise<SignedTx>;
  submit(signed: SignedTx): Promise<TxHandle>;
  watch(handle: TxHandle): AsyncIterable<TxStatus>;
  /**
   * Tell the UI what memo / destination-tag shape this surface accepts for
   * a given intent. Optional — surfaces that never need a memo can omit it
   * (kernel treats absence as `MEMO_SPEC_NONE`). Recipients differ even
   * within a surface (an exchange Canton party may require memos while a
   * personal party may not), so the spec is per-intent, not per-surface.
   */
  memoSpec?(intent: Intent): MemoSpec;
}
