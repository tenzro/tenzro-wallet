/**
 * ERC-4337 v0.8 UserOperations for passkey accounts.
 *
 * A person's account is a smart account guarded by the WebAuthn validator.
 * To move value the wallet builds a UserOperation, hashes it (EIP-712,
 * EntryPoint domain "0.8"), has an enrolled passkey sign it (the WebAuthn
 * challenge is `signingDigest(UserOperation, hash)`), and submits it with
 * `eth_sendUserOperation`.
 *
 * The signature is the validator's bundle (`encodePasskeySignatureBundle`),
 * one entry per contributing passkey.
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
export function userOperationHash(
  op: UserOperation,
  chainId: bigint,
  entryPoint: string,
): Uint8Array {
  return keccak256(
    concatBytes(
      new Uint8Array([0x19, 0x01]),
      entryPointDomainSeparator(chainId, entryPoint),
      userOperationStructHash(op),
    ),
  );
}

/** One call a UserOperation makes. */
export interface Execution {
  readonly to: string;
  readonly value: bigint;
  readonly data?: Uint8Array;
}

/** ERC-7579 `execute(bytes32 mode, bytes executionCalldata)`. */
const EXECUTE_SELECTOR = new Uint8Array([0xe9, 0xae, 0x5c, 0x53]);
const CALLTYPE_SINGLE = 0x00;
const CALLTYPE_BATCH = 0x01;
/** The most calls the network accepts in one batch. */
export const MAX_BATCH_CALLS = 64;
const MAX_VALUE = (1n << 128n) - 1n;

function target(to: string): Uint8Array {
  const t = fromHex(to);
  if (t.length !== 20) throw new Error('execute target must be a 20-byte address');
  return t;
}

function checkValue(value: bigint): void {
  if (value < 0n || value > MAX_VALUE) throw new Error('execute value must fit in 128 bits');
}

/** Length-prefixed ABI `bytes`, padded to a 32-byte boundary. */
function abiBytes(data: Uint8Array): Uint8Array {
  const padded = new Uint8Array(Math.ceil(data.length / 32) * 32);
  padded.set(data);
  return concatBytes(uint256(BigInt(data.length)), padded);
}

function execute(callType: number, executionCalldata: Uint8Array): Uint8Array {
  const mode = new Uint8Array(32);
  mode[0] = callType; // exec type 0x00: revert on failure
  return concatBytes(EXECUTE_SELECTOR, mode, uint256(0x40n), abiBytes(executionCalldata));
}

/** One call: executionCalldata = target (20) || value (32, big-endian) || data. */
export function encodeExecuteSingle(call: Execution): Uint8Array {
  checkValue(call.value);
  return execute(
    CALLTYPE_SINGLE,
    concatBytes(target(call.to), uint256(call.value), call.data ?? new Uint8Array(0)),
  );
}

/**
 * Several calls, atomically: executionCalldata = abi.encode((address,uint256,bytes)[]).
 * Every call is checked, and spending limits count the batch's total value.
 */
export function encodeExecuteBatch(calls: readonly Execution[]): Uint8Array {
  if (calls.length === 0) throw new Error('a batch needs at least one call');
  if (calls.length > MAX_BATCH_CALLS)
    throw new Error(`a batch holds at most ${MAX_BATCH_CALLS} calls`);
  const tuples = calls.map((c) => {
    checkValue(c.value);
    return concatBytes(
      addressWord(c.to),
      uint256(c.value),
      uint256(0x60n),
      abiBytes(c.data ?? new Uint8Array(0)),
    );
  });
  let offset = 32 * calls.length;
  const offsets = tuples.map((t) => {
    const at = uint256(BigInt(offset));
    offset += t.length;
    return at;
  });
  return execute(
    CALLTYPE_BATCH,
    concatBytes(uint256(0x20n), uint256(BigInt(calls.length)), ...offsets, ...tuples),
  );
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
