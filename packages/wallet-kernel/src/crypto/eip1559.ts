/**
 * EIP-1559 typed-transaction encoding (transaction type 0x02).
 *
 * Wire format per EIP-1559:
 *   signing_payload  = 0x02 || rlp([
 *     chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit,
 *     to, value, data, accessList,
 *   ])
 *   signing_hash     = keccak256(signing_payload)
 *   serialized_tx    = 0x02 || rlp([... above 9 fields ..., yParity, r, s])
 *
 * `yParity` is 0 or 1 (NOT the legacy `27 + chainId*2 + ...` form).
 *
 * Refs: https://eips.ethereum.org/EIPS/eip-1559,
 *       https://eips.ethereum.org/EIPS/eip-2930 (access list),
 *       https://eips.ethereum.org/EIPS/eip-2718 (typed-tx envelope).
 */

import { keccak256 } from './keccak256.ts';
import { type RLPItem, bigintToBytes, hexToBytes, numberToBytes, rlpEncode } from './rlp.ts';

export interface Eip1559Tx {
  readonly chainId: number;
  readonly nonce: number;
  readonly maxPriorityFeePerGas: bigint;
  readonly maxFeePerGas: bigint;
  readonly gasLimit: bigint;
  readonly to: `0x${string}`;
  readonly value: bigint;
  readonly data: Uint8Array;
  /** Access list entries: `[address, [storageKey, storageKey, …]]`. */
  readonly accessList?: readonly {
    readonly address: `0x${string}`;
    readonly storageKeys: readonly `0x${string}`[];
  }[];
}

const TX_TYPE = 0x02;

/** RLP-encoded body without the type byte; useful for hashing under the type. */
function bodyItems(tx: Eip1559Tx): RLPItem {
  const accessListItems: RLPItem = (tx.accessList ?? []).map((e) => [
    hexToBytes(e.address),
    e.storageKeys.map((k) => hexToBytes(k)),
  ]);
  return [
    numberToBytes(tx.chainId),
    numberToBytes(tx.nonce),
    bigintToBytes(tx.maxPriorityFeePerGas),
    bigintToBytes(tx.maxFeePerGas),
    bigintToBytes(tx.gasLimit),
    hexToBytes(tx.to),
    bigintToBytes(tx.value),
    tx.data,
    accessListItems,
  ];
}

/** Pre-image bytes the signer must hash: `0x02 || rlp(body)`. */
export function encodeForSigning(tx: Eip1559Tx): Uint8Array {
  const body = rlpEncode(bodyItems(tx));
  const out = new Uint8Array(1 + body.length);
  out[0] = TX_TYPE;
  out.set(body, 1);
  return out;
}

/** 32-byte signing hash over the EIP-1559 pre-image. */
export function signingHash(tx: Eip1559Tx): Uint8Array {
  return keccak256(encodeForSigning(tx));
}

export interface Eip1559Signature {
  /** 0 or 1. */
  readonly yParity: number;
  /** Big-endian, ≤32 bytes. */
  readonly r: Uint8Array;
  /** Big-endian, ≤32 bytes. */
  readonly s: Uint8Array;
}

/** Wire-format serialized tx: `0x02 || rlp(body || [yParity, r, s])`. */
export function serializeSigned(tx: Eip1559Tx, sig: Eip1559Signature): Uint8Array {
  const body = bodyItems(tx) as RLPItem[];
  const full: RLPItem = [...body, numberToBytes(sig.yParity), sig.r, sig.s];
  const enc = rlpEncode(full);
  const out = new Uint8Array(1 + enc.length);
  out[0] = TX_TYPE;
  out.set(enc, 1);
  return out;
}

/**
 * Parse a 65-byte secp256k1 signature (r||s||v) into the EIP-1559 shape.
 * Some signing drivers emit `v` as 27/28 (legacy) and some as 0/1 (modern);
 * we accept either.
 */
export function splitSignature(sig: Uint8Array): Eip1559Signature {
  if (sig.length !== 65) {
    throw new Error(`expected 65-byte signature, got ${sig.length}`);
  }
  const r = sig.subarray(0, 32);
  const s = sig.subarray(32, 64);
  const v = sig[64]!;
  const yParity = v === 27 || v === 28 ? v - 27 : v;
  if (yParity !== 0 && yParity !== 1) {
    throw new Error(`invalid yParity: derived ${yParity} from v=${v}`);
  }
  return { yParity, r, s };
}
