/**
 * Surface-internal helpers. Not exported from the package root.
 */

import type { Intent, TxHandle, TxStatus } from '../types/intent.ts';
import type { SurfaceName } from '../types/surface.ts';

let counter = 0;

export function makeHandle(
  surface: SurfaceName,
  _intent: Intent,
  hash?: string,
): TxHandle {
  counter += 1;
  return {
    id: `${surface}-${Date.now().toString(36)}-${counter.toString(36)}`,
    surface,
    submittedAt: Date.now(),
    ...(hash !== undefined ? { hash } : {}),
  };
}

/**
 * M1 placeholder confirmation walk: created → pending → confirmed → finalized.
 *
 * Used by every surface that doesn't yet have a real port wired. As of M2,
 * `tenzro-native` replaces this with `watchViaPort` against a real RPC; the
 * remaining consumers (evm-on-tenzro, svm-on-tenzro, canton-internal,
 * canton-external) keep using this until their respective milestones land.
 *
 * Delete this when no surface imports it any more.
 */
export async function* mockStatusWalk(handle: TxHandle): AsyncIterable<TxStatus> {
  yield { handle, phase: 'created' };
  await sleep(10);
  yield { handle, phase: 'pending' };
  await sleep(10);
  yield { handle, phase: 'confirmed', blockHeight: 1, hash: `0x${handle.id}` };
  await sleep(10);
  yield { handle, phase: 'finalized', blockHeight: 1, hash: `0x${handle.id}` };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
