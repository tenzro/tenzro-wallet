/**
 * Intent / Preview / Signed / Handle / Status — the four-step lifecycle every
 * surface module implements. The kernel never inspects the inside of a
 * `PreparedTx` or `SignedTx`; it just plumbs them through the surface.
 */

import type { AssetId } from './asset.ts';
import type { TdipDid } from './identity.ts';
import type { SurfaceName } from './surface.ts';

/** Recipient address. The shape depends on the destination surface. */
export type Recipient =
  | { readonly kind: 'tdip'; readonly did: TdipDid }
  | { readonly kind: 'evm'; readonly address: `0x${string}` }
  | { readonly kind: 'svm'; readonly publicKey: string }
  | { readonly kind: 'canton'; readonly partyId: string };

/**
 * What the user wants to happen, expressed before the kernel has chosen a route.
 */
export interface SendIntent {
  readonly kind: 'send';
  readonly from: TdipDid;
  readonly to: Recipient;
  readonly asset: AssetId;
  readonly amount: bigint;
  /**
   * Memo / destination tag / payment id — generalised across surfaces. Canton
   * uses it as the transfer description; Stellar/XRPL (via bridge) use it as
   * a destination tag; some exchanges require it to credit the recipient.
   * `surface.memoSpec(intent)` (when implemented) tells the UI what shape and
   * whether it's required.
   */
  readonly memo?: string;
  /**
   * Force a specific source surface. If omitted, the router chooses based on
   * asset scope and recipient kind.
   */
  readonly fromSurface?: SurfaceName;
}

export type Intent = SendIntent;
// Future: EscrowIntent, ChannelIntent, BridgeIntent — same lifecycle.

/** How the kernel proposes to execute an intent. */
export type Route =
  | { readonly kind: 'native'; readonly surface: SurfaceName }
  | {
      readonly kind: 'cross-vm-pointer';
      readonly fromSurface: SurfaceName;
      readonly toSurface: SurfaceName;
      /** Cross-VM Bridge precompile address on EVM-on-Tenzro. */
      readonly precompile: '0x1003';
    }
  | {
      readonly kind: 'bridge';
      readonly fromSurface: SurfaceName;
      readonly toSurface: SurfaceName;
      readonly adapter: 'lifi' | 'layerzero' | 'ccip' | 'debridge' | 'canton-adapter';
    };

/** Reversibility hint shown to the user. */
export type Reversibility = 'final-on-submit' | 'reversible-until-confirmed' | 'irreversible';

export interface FeeBreakdown {
  readonly asset: AssetId;
  readonly amount: bigint;
  readonly label: string;
}

/**
 * Result of `surface.prepare(intent)`. Opaque transaction body lives in `body`;
 * everything else is for UI rendering and consent.
 */
export interface PreparedTx {
  readonly route: Route;
  readonly intent: Intent;
  readonly fees: readonly FeeBreakdown[];
  readonly etaMs: number;
  readonly reversibility: Reversibility;
  readonly warnings: readonly string[];
  /** Surface-specific transaction body — opaque to the kernel. */
  readonly body: unknown;
}

/** Result of `surface.sign(prepared, consent)`. */
export interface SignedTx {
  readonly prepared: PreparedTx;
  readonly signatures: readonly Uint8Array[];
  readonly body: unknown;
}

/** Returned by `surface.submit(signed)` — used to track the tx after submission. */
export interface TxHandle {
  readonly id: string;
  readonly surface: SurfaceName;
  readonly submittedAt: number;
  /** On-chain transaction hash. Optional only because the M1 mock surfaces
   *  produced handles before they had real chain hashes; real surfaces
   *  always populate it. */
  readonly hash?: string;
}

export type TxStatusPhase =
  | 'created'
  | 'pending'
  | 'confirmed'
  | 'finalized'
  | 'failed'
  | 'dropped';

export interface TxStatus {
  readonly handle: TxHandle;
  readonly phase: TxStatusPhase;
  readonly blockHeight?: number;
  readonly hash?: string;
  readonly error?: string;
}

// ──────────────────────────── Memo / destination tag ────────────────────────────

/**
 * Surface-declared memo requirement. Returned by `SurfaceModule.memoSpec`
 * (optional method); the kernel forwards this to the UI so consent flows
 * can show the right input. `kind` is the dialect:
 *
 *   - `text`     — free-form string (Canton transfer description, generic memo)
 *   - `numeric`  — uint string (Stellar `MEMO_ID`, XRPL destination tag)
 *   - `hash`     — 32-byte hex (Stellar `MEMO_HASH`)
 *
 * `required` is true when the destination *will fail to credit* without the
 * memo. The kernel doesn't enforce the requirement itself — that's the
 * surface's job at `prepare` time — but the UI uses the flag to mark the
 * field as "required" rather than "optional".
 */
export interface MemoSpec {
  readonly kind: 'text' | 'numeric' | 'hash';
  readonly required: boolean;
  /** Optional max length / byte limit (e.g. Canton: 256 chars). */
  readonly maxLength?: number;
  /** UI-only, e.g. "Destination tag" / "Transfer description". */
  readonly label?: string;
}

/** No-memo sentinel — surfaces that don't accept a memo return this. */
export const MEMO_SPEC_NONE: MemoSpec = { kind: 'text', required: false, maxLength: 0 };
