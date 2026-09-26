/**
 * Recognize an address by format alone, so the send orchestrator can
 * pick the right rail without making the user choose.
 *
 * Tenzro accounts are 20-byte hex (40 chars after `0x`), sometimes shown
 * widened to 32 bytes (64 chars). Solana uses base58-encoded Ed25519
 * pubkeys (typically 43-44 chars from `[1-9A-HJ-NP-Za-km-z]`).
 */

export type AddressKind =
  | { kind: 'tenzro'; address: string }
  | { kind: 'evm'; address: string }
  | { kind: 'svm'; address: string }
  | { kind: 'unknown'; reason: string };

const HEX_RE = /^0x[0-9a-fA-F]+$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function detectAddress(raw: string): AddressKind {
  const v = raw.trim();
  if (!v) return { kind: 'unknown', reason: 'Empty input' };

  if (HEX_RE.test(v)) {
    const hexLen = v.length - 2;
    if (hexLen === 64) return { kind: 'tenzro', address: v.toLowerCase() };
    if (hexLen === 40) return { kind: 'evm', address: v.toLowerCase() };
    return {
      kind: 'unknown',
      reason: `Hex address must be 40 chars (EVM) or 64 chars (Tenzro), got ${hexLen}`,
    };
  }

  if (BASE58_RE.test(v) && v.length >= 32 && v.length <= 44) {
    return { kind: 'svm', address: v };
  }

  return { kind: 'unknown', reason: 'Not a recognized address format' };
}
