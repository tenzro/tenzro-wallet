/**
 * Send planning: turn a recipient into a route without making the user
 * think about VM views.
 *
 *  detect(recipient)
 *    ├─ 20-byte 0x address, or a 32-byte Tenzro address  → Tenzro transfer
 *    │     (passkey-signed UserOperation from the account)
 *    ├─ Solana base58                                   → another network
 *    └─ unknown                                         → reject
 *
 * Transfers to other networks go through a bridge; the web wallet shows the
 * route but does not submit bridge transfers yet.
 */

import { detectAddress } from './address';

export type SendRoute =
  | { kind: 'tenzro'; recipient: string }
  | { kind: 'external'; recipient: string; network: string }
  | { kind: 'invalid'; reason: string };

export interface PlanInput {
  readonly recipient: string;
}

export function planSend(input: PlanInput): SendRoute {
  const detected = detectAddress(input.recipient);
  switch (detected.kind) {
    case 'unknown':
      return { kind: 'invalid', reason: detected.reason };
    case 'tenzro':
    case 'evm':
      return { kind: 'tenzro', recipient: toAccountAddress(detected.address) };
    case 'svm':
      return { kind: 'external', recipient: detected.address, network: 'Solana' };
  }
}

/** Account calls take 20-byte addresses; 32-byte Tenzro addresses are widened on the left. */
export function toAccountAddress(address: string): string {
  const hex = address.slice(2).toLowerCase();
  if (hex.length === 40) return `0x${hex}`;
  if (hex.length === 64 && /^0{24}/.test(hex)) return `0x${hex.slice(24)}`;
  return `0x${hex}`;
}
