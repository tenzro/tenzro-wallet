/**
 * ERC-4337 v0.8 UserOperations for passkey accounts.
 *
 * A person's account is a smart account guarded by the WebAuthn validator.
 * To move value the wallet builds a UserOperation, hashes it (EIP-712,
 * EntryPoint domain "0.8"), has an enrolled passkey sign that hash (the
 * WebAuthn challenge is the raw 32-byte hash) together with the passkey's
 * ML-DSA-65 key, and submits it with `eth_sendUserOperation`.
 *
 * The signature is the validator's bundle: a bincode (1.x, fixint, little
 * endian) `Vec<HybridWebAuthnSignature>`, one entry per contributing passkey.
 */

import { keccak256 } from '../../crypto/keccak256.ts';
import { concatBytes, fromHex, toHex, utf8 } from './bytes.ts';

export interface UserOperation {
  readonly sender: string;
  /** 2-D nonce, `(key << 64) | seq`. */
  readonly nonce: bigint;
  readonly factory?: string;
  readonly factoryData?: Uint8Array;
  readonly callData: Uint8Array;
  readonly callGasLimit: bigint;
  readonly verificationGasLimit: bigint;
  readonly preVerificationGas: bigint;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly paymaster?: string;
  readonly paymasterVerificationGasLimit?: bigint;
  readonly paymasterPostOpGasLimit?: bigint;
  readonly paymasterData?: Uint8Array;
  readonly signature?: Uint8Array;
}

/** Gas defaults for a plain value transfer from a passkey account. */
export const DEFAULT_USER_OP_GAS = {
  callGasLimit: 100_000n,
  verificationGasLimit: 500_000n,
  preVerificationGas: 50_000n,
} as const;

const USER_OP_TYPE =
  'UserOperation(address sender,uint256 nonce,address factory,bytes factoryData,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,address paymaster,uint256 paymasterVerificationGasLimit,uint256 paymasterPostOpGasLimit,bytes paymasterData)';
const DOMAIN_TYPE =
  'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';

function uint256(v: bigint): Uint8Array {
  if (v < 0n || v >= 1n << 256n) throw new Error('uint256 out of range');
  const out = new Uint8Array(32);
  let x = v;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/** Address as a left-padded 32-byte word (low 20 bytes; empty = zero). */
function addressWord(addr: string | undefined): Uint8Array {
  const out = new Uint8Array(32);
  if (!addr) return out;
  const bytes = fromHex(addr);
  const tail = bytes.slice(0, Math.min(20, bytes.length));
  out.set(tail, 32 - tail.length);
  return out;
}

export function userOperationTypeHash(): Uint8Array {
  return keccak256(utf8(USER_OP_TYPE));
}

export function entryPointDomainSeparator(chainId: bigint, entryPoint: string): Uint8Array {
  return keccak256(
    concatBytes(
      keccak256(utf8(DOMAIN_TYPE)),
      keccak256(utf8('EntryPoint')),
      keccak256(utf8('0.8')),
      uint256(chainId),
      addressWord(entryPoint),
    ),
  );
}

export function userOperationStructHash(op: UserOperation): Uint8Array {
  return keccak256(
    concatBytes(
      userOperationTypeHash(),
      addressWord(op.sender),
      uint256(op.nonce),
      addressWord(op.factory),
      keccak256(op.factoryData ?? new Uint8Array(0)),
      keccak256(op.callData),
      uint256(op.callGasLimit),
      uint256(op.verificationGasLimit),
      uint256(op.preVerificationGas),
      uint256(op.maxFeePerGas),
      uint256(op.maxPriorityFeePerGas),
      addressWord(op.paymaster),
      uint256(op.paymasterVerificationGasLimit ?? 0n),
      uint256(op.paymasterPostOpGasLimit ?? 0n),
      keccak256(op.paymasterData ?? new Uint8Array(0)),
    ),
  );
}

/** `keccak256(0x19 0x01 || domainSeparator || structHash)`: the hash the passkey signs. */
export function userOperationHash(op: UserOperation, chainId: bigint, entryPoint: string): Uint8Array {
  return keccak256(
    concatBytes(
      new Uint8Array([0x19, 0x01]),
      entryPointDomainSeparator(chainId, entryPoint),
      userOperationStructHash(op),
    ),
  );
}

/** ABI `execute(address to, uint256 value, bytes data)` calldata (selector `0xb61d27f6`). */
export function encodeExecuteCall(to: string, value: bigint, data: Uint8Array = new Uint8Array(0)): Uint8Array {
  const target = fromHex(to);
  if (target.length !== 20) throw new Error('execute target must be a 20-byte address');
  const padded = new Uint8Array(Math.ceil(data.length / 32) * 32);
  padded.set(data);
  return concatBytes(
    new Uint8Array([0xb6, 0x1d, 0x27, 0xf6]),
    addressWord(to),
    uint256(value),
    uint256(0x60n),
    uint256(BigInt(data.length)),
    padded,
  );
}

export interface HybridSignatureEntry {
  readonly authenticatorData: Uint8Array;
  readonly clientDataJson: Uint8Array;
  readonly signature: Uint8Array;
  readonly userHandle?: Uint8Array;
  readonly mlDsaSignature: Uint8Array;
  readonly credentialId: Uint8Array;
}

function u64le(n: number): Uint8Array {
  const out = new Uint8Array(8);
  let x = BigInt(n);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

const vecBytes = (b: Uint8Array): Uint8Array => concatBytes(u64le(b.length), b);

/** bincode 1.x encoding of `Vec<HybridWebAuthnSignature>` for `userOp.signature`. */
export function encodeHybridSignatureBundle(entries: readonly HybridSignatureEntry[]): Uint8Array {
  const parts: Uint8Array[] = [u64le(entries.length)];
  for (const e of entries) {
    parts.push(
      vecBytes(e.authenticatorData),
      vecBytes(e.clientDataJson),
      vecBytes(e.signature),
      e.userHandle ? concatBytes(new Uint8Array([1]), vecBytes(e.userHandle)) : new Uint8Array([0]),
      vecBytes(e.mlDsaSignature),
      vecBytes(e.credentialId),
    );
  }
  return concatBytes(...parts);
}

const q = (v: bigint): string => `0x${v.toString(16)}`;

/** JSON shape accepted by `eth_sendUserOperation` / `eth_estimateUserOperationGas`. */
export function userOperationToJson(op: UserOperation): Record<string, string> {
  return {
    sender: op.sender,
    nonce: q(op.nonce),
    ...(op.factory ? { factory: op.factory } : {}),
    ...(op.factoryData?.length ? { factoryData: toHex(op.factoryData, true) } : {}),
    callData: toHex(op.callData, true),
    callGasLimit: q(op.callGasLimit),
    verificationGasLimit: q(op.verificationGasLimit),
    preVerificationGas: q(op.preVerificationGas),
    maxFeePerGas: q(op.maxFeePerGas),
    maxPriorityFeePerGas: q(op.maxPriorityFeePerGas),
    ...(op.paymaster ? { paymaster: op.paymaster } : {}),
    ...(op.paymasterVerificationGasLimit !== undefined
      ? { paymasterVerificationGasLimit: q(op.paymasterVerificationGasLimit) }
      : {}),
    ...(op.paymasterPostOpGasLimit !== undefined
      ? { paymasterPostOpGasLimit: q(op.paymasterPostOpGasLimit) }
      : {}),
    ...(op.paymasterData?.length ? { paymasterData: toHex(op.paymasterData, true) } : {}),
    signature: toHex(op.signature ?? new Uint8Array(0), true),
  };
}
