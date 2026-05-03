/**
 * CrossVmPointerPort — wire-level shape of a cross-VM pointer op on Tenzro.
 *
 * Tenzro Ledger holds a single canonical TNZO balance. Each on-Tenzro surface
 * (tenzro-native, evm-on-tenzro, svm-on-tenzro, canton-internal) presents a
 * *view* of that balance at its own decimal precision. Moving TNZO "from" one
 * view "to" another is therefore not a value transfer — it's a balance-view
 * pointer update. The Tenzro runtime exposes this as:
 *
 *   - On EVM-on-Tenzro:  precompile call to 0x1003, calldata =
 *       abi.encode(toSurface, owner, amount).
 *   - On SVM-on-Tenzro:  a `tenzro_cross_vm` system program instruction
 *       carrying the same payload.
 *   - On tenzro-native:  a native syscall (`crossvm_pointer_move`).
 *   - On canton-internal: same as native, executed inside DAML choice on the
 *       Tenzro-internal synchroniser (M4 wires this; M3 stops at native/EVM/SVM).
 *
 * Each surface module owns the encoding of its own pointer-op tx. This port
 * exists so the kernel can describe the *intent* of a pointer op uniformly,
 * and so dust-truncation accounting at the EVM↔SVM boundary lives in one
 * place (see `decimalsFor` + `truncateForView`).
 *
 * Notes:
 *   - Pointer ops are atomic and free of value-transfer fees on Tenzro. Gas is
 *     still charged at the source surface (e.g. EVM-side gas for a precompile
 *     call from EVM-on-Tenzro). The router surfaces this as a single fee row,
 *     not as a "bridge fee."
 *   - The "receive" side has no work to do — the balance view update is a
 *     side-effect of the source-side tx. `watch()` is the source surface's
 *     own watch loop (e.g. EVM tx receipt).
 *
 * Refs:
 *   - https://tenzro.com/docs/multi-vm
 *   - https://tenzro.com/docs/cross-vm-tokens
 *   - DESIGN.md §2 (the four surfaces), §5.2 (decimal problem),
 *     §6.1 (route table — pointer ops vs bridges).
 */

import type { TdipDid } from '../types/identity.ts';
import type { SurfaceName } from '../types/surface.ts';

/** Cross-VM pointer-op address constant. */
export const CROSS_VM_PRECOMPILE = '0x1003' as const;

/**
 * The pointer-op intent, surface-agnostic. Each source surface reads this and
 * encodes its own wire-format tx (EVM precompile call, SVM system instruction,
 * native syscall).
 *
 * `amount` is in canonical native units (1 TNZO = 10^18). Truncation to the
 * destination view's precision happens via `truncateForView` and any residual
 * dust is surfaced as a `PreparedTx.warnings` entry.
 */
export interface CrossVmPointerOp {
  readonly fromSurface: SurfaceName;
  readonly toSurface: SurfaceName;
  /** TDIP DID owning the balance — same DID on both surfaces. */
  readonly owner: TdipDid;
  /** Amount to move, in canonical native units (10^18-scaled). */
  readonly amount: bigint;
}

/**
 * Return the decimal precision a surface uses for its TNZO view. The kernel
 * stores balances in canonical 10^18 units; surfaces convert at the wire.
 */
export function decimalsFor(surface: SurfaceName): number {
  switch (surface) {
    case 'tenzro-native':
      return 18;
    case 'evm-on-tenzro':
      return 18;
    case 'svm-on-tenzro':
      return 9;
    case 'canton-internal':
      return 10;
    case 'canton-external':
      return 10;
  }
}

/**
 * Truncate a canonical (10^18) amount to the precision of `surface`, then
 * re-expand to canonical units. The difference between input and output is
 * the dust that gets dropped on the destination view.
 *
 * Example: 1.000_000_000_500_000_000 TNZO from EVM (18 dec) into SVM (9 dec)
 * truncates the trailing 500_000_000 sub-units (sub-lamport dust).
 */
export function truncateForView(amount: bigint, surface: SurfaceName): bigint {
  const dec = decimalsFor(surface);
  if (dec >= 18) return amount;
  const div = 10n ** BigInt(18 - dec);
  return (amount / div) * div;
}

/**
 * Sub-unit dust that would be lost moving `amount` from one canonical-units
 * view to a lower-precision view. Positive only when the destination has
 * fewer decimals than 18 and `amount` is not a whole multiple of that step.
 */
export function dustResidual(amount: bigint, toSurface: SurfaceName): bigint {
  return amount - truncateForView(amount, toSurface);
}
