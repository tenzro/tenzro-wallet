/**
 * Typed consensus transactions for the agent ports.
 *
 * Writes go through the SDK's `TypedTxClient.send`: it asks the node for the
 * signing payload (`tenzro_getSigningPayload`), checks that the payload is the
 * transaction it asked for, and signs it with the holder's `HybridSigner`. The
 * node never signs. The kernel never makes a signer; the host passes the one
 * its hardware or passkey provides.
 */

import type { HybridSigner, TypedTransaction } from 'tenzro-sdk';

/** The slice of `TypedTxClient` the adapters use. */
export interface TypedTxSender {
  send(signer: HybridSigner, tx: TypedTransaction): Promise<unknown>;
}

/** A 32-byte value (hex, with or without `0x`) as the byte array the node encodes. */
export function bytes32(hex: string, what: string): number[] {
  const b = bytes(hex, what);
  if (b.length !== 32) throw new Error(`${what} must be 32 bytes, got ${b.length}`);
  return b;
}

/** Hex (with or without `0x`) as a byte array. */
export function bytes(hex: string, what: string): number[] {
  const c = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (c.length % 2 !== 0 || /[^0-9a-fA-F]/.test(c)) throw new Error(`${what} is not hex`);
  return Array.from(c.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
}

/**
 * A u128 amount as the node writes it: a number up to u64, a decimal string
 * above. The SDK compares the node's encoding after a JSON round trip, so an
 * amount up to u64 that a JSON number cannot hold exactly is refused here
 * rather than rounded.
 */
export function u128(v: bigint, what: string): number | string {
  if (v < 0n) throw new Error(`${what} must not be negative`);
  if (v > 0xffff_ffff_ffff_ffffn) return v.toString();
  const n = Number(v);
  if (BigInt(n) !== v) {
    throw new Error(`${what} ${v} cannot be sent exactly; round it to a representable amount`);
  }
  return n;
}

/** The transaction hash `eth_sendRawTransaction` answers with. */
export function txHash(result: unknown): string {
  if (typeof result !== 'string') throw new Error('the node did not return a transaction hash');
  return result;
}
