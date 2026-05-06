/**
 * EVM surface inside the Tenzro multi-VM runtime. wTNZO ERC-20 lives at
 * 0x7a4bcb13a6b2b384c284b5caa6e5ef3126527f93. Cross-VM token moves to other
 * on-Tenzro surfaces are pointer ops via precompile 0x1003 — handled by the
 * router, not by this surface directly.
 */

import {
  type Eip1559Tx,
  encodeForSigning,
  serializeSigned,
  signingHash,
  splitSignature,
} from '../crypto/eip1559.ts';
import {
  CROSS_VM_PRECOMPILE,
  type CrossVmPointerOp,
  dustResidual,
  truncateForView,
} from '../ports/cross-vm.ts';
import type { Consent } from '../types/consent.ts';
import type { SurfaceKey, TdipDid } from '../types/identity.ts';
import type { Intent, PreparedTx, SignedTx, TxHandle, TxStatus } from '../types/intent.ts';
import type { SigningDriver } from '../types/signing-driver.ts';
import type { SurfaceModule } from '../types/surface-module.ts';
import { makeHandle, mockStatusWalk } from './util.ts';

interface EvmBody {
  readonly kind: 'evm-send';
  readonly from: `0x${string}`;
  readonly to: `0x${string}`;
  readonly value: bigint;
  readonly nonce: number;
  readonly chainId: number;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly gasLimit: bigint;
}

/**
 * Cross-VM pointer-op body. Addresses precompile 0x1003 with calldata that
 * encodes (toSurface, owner, amount). We carry the pointer-op fields next to
 * the EVM tx envelope so `sign()`/`submit()` can encode either kind via the
 * same wire path. M3 keeps `data` as a JSON-encoded payload — the EIP-1559
 * RLP encoder lands in M3.3 alongside real EVM-send encoding.
 */
interface EvmPointerBody {
  readonly kind: 'evm-pointer';
  readonly from: `0x${string}`;
  readonly to: typeof CROSS_VM_PRECOMPILE;
  readonly value: 0n;
  readonly nonce: number;
  readonly chainId: number;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly gasLimit: bigint;
  /** ABI-encoded calldata for precompile 0x1003. M3.3 swaps this for real
   *  ABI encoding; M3 stores the structured payload alongside. */
  readonly data: Uint8Array;
  readonly pointer: CrossVmPointerOp;
}

export interface EvmOnTenzroDeps {
  readonly keyResolver: (did: TdipDid) => SurfaceKey | undefined;
  readonly signingDriver: SigningDriver;
  readonly rpc?: {
    getNonce(addr: `0x${string}`): Promise<number>;
    getChainId(): Promise<number>;
    estimateFees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
    /**
     * Broadcast wire-format bytes (`0x02 || rlp(...)` for EIP-1559) and
     * return the tx hash. Maps to `eth_sendRawTransaction` on real EVM
     * RPC nodes.
     */
    sendRawTransaction(rawTx: Uint8Array): Promise<string>;
  };
}

export function evmOnTenzroSurface(deps: EvmOnTenzroDeps): SurfaceModule {
  const rpc = deps.rpc ?? mockRpc();

  return {
    name: 'evm-on-tenzro',

    async prepare(intent: Intent): Promise<PreparedTx> {
      if (intent.kind !== 'send') throw new Error(`unsupported: ${intent.kind}`);
      if (intent.to.kind !== 'evm') {
        throw new Error('evm-on-tenzro requires an EVM recipient');
      }
      const fromKey = deps.keyResolver(intent.from);
      if (!fromKey || fromKey.surface !== 'evm-on-tenzro') {
        throw new Error(`no evm-on-tenzro key for ${intent.from}`);
      }
      const [nonce, chainId, fees] = await Promise.all([
        rpc.getNonce(fromKey.address),
        rpc.getChainId(),
        rpc.estimateFees(),
      ]);

      const body: EvmBody = {
        kind: 'evm-send',
        from: fromKey.address,
        to: intent.to.address,
        value: intent.amount,
        nonce,
        chainId,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        gasLimit: 21000n,
      };

      return {
        route: { kind: 'native', surface: 'evm-on-tenzro' },
        intent,
        fees: [
          {
            asset: intent.asset,
            amount: body.gasLimit * body.maxFeePerGas,
            label: 'evm gas',
          },
        ],
        etaMs: 1000,
        reversibility: 'final-on-submit',
        warnings: [],
        body,
      };
    },

    async preparePointer(intent: Intent, op: CrossVmPointerOp): Promise<PreparedTx> {
      if (intent.kind !== 'send') throw new Error(`unsupported: ${intent.kind}`);
      const fromKey = deps.keyResolver(intent.from);
      if (!fromKey || fromKey.surface !== 'evm-on-tenzro') {
        throw new Error(`no evm-on-tenzro key for ${intent.from}`);
      }
      const [nonce, chainId, fees] = await Promise.all([
        rpc.getNonce(fromKey.address),
        rpc.getChainId(),
        rpc.estimateFees(),
      ]);

      const body: EvmPointerBody = {
        kind: 'evm-pointer',
        from: fromKey.address,
        to: CROSS_VM_PRECOMPILE,
        value: 0n,
        nonce,
        chainId,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        // Pointer ops cost more than a plain send because the precompile
        // touches multiple-VM state. 80k is a placeholder; M3.3 / a Tenzro
        // gas oracle will refine.
        gasLimit: 80_000n,
        data: encodePointerCall(op),
        pointer: op,
      };

      const dust = dustResidual(op.amount, op.toSurface);
      const truncated = truncateForView(op.amount, op.toSurface);
      const warnings: string[] = [];
      if (dust > 0n) {
        warnings.push(
          `${dust.toString()} sub-units below ${op.toSurface} precision will ` +
            `not appear in the destination view; ${truncated.toString()} ` +
            `canonical units will move`,
        );
      }

      return {
        route: {
          kind: 'cross-vm-pointer',
          fromSurface: 'evm-on-tenzro',
          toSurface: op.toSurface,
          precompile: CROSS_VM_PRECOMPILE,
        },
        intent,
        fees: [
          {
            asset: intent.asset,
            amount: body.gasLimit * body.maxFeePerGas,
            label: 'evm gas (pointer call)',
          },
        ],
        // Pointer ops settle in the same EVM block — same ETA shape as a send.
        etaMs: 1000,
        reversibility: 'final-on-submit',
        warnings,
        body,
      };
    },

    async sign(prepared: PreparedTx, _consent: Consent): Promise<SignedTx> {
      const body = prepared.body as EvmBody | EvmPointerBody;
      const did = (prepared.intent as Extract<Intent, { kind: 'send' }>).from;
      const key = deps.keyResolver(did);
      if (!key || key.surface !== 'evm-on-tenzro') {
        throw new Error('missing evm key at sign time');
      }
      const preimage = canonicalize(body);
      const result = await deps.signingDriver.sign({
        did,
        surfaceKey: key,
        scheme: 'secp256k1',
        preimage,
        purpose: body.kind === 'evm-pointer' ? 'evm-pointer' : 'evm-send',
      });
      return { prepared, signatures: result.signatures, body };
    },

    async submit(signed: SignedTx): Promise<TxHandle> {
      const body = signed.body as EvmBody | EvmPointerBody;
      const sig = signed.signatures[0];
      if (!sig) throw new Error('missing signature');
      const rawTx = serializeForSubmit(body, sig);
      const hash = await rpc.sendRawTransaction(rawTx);
      return makeHandle('evm-on-tenzro', signed.prepared.intent, hash);
    },

    watch(handle: TxHandle): AsyncIterable<TxStatus> {
      return mockStatusWalk(handle);
    },
  };
}

/**
 * Encode the calldata for a pointer-op call to precompile 0x1003.
 *
 * The outer EIP-1559 envelope is real (RLP-encoded, keccak-hashed,
 * secp256k1-signed) — what's still placeholder is the *inner* calldata
 * format. The Tenzro precompile's exact Solidity-side ABI signature is not
 * pinned in our docs yet; once `https://tenzro.com/docs/cross-vm-tokens`
 * publishes the canonical signature (likely
 * `(uint8 toSurfaceTag, bytes32 owner, uint256 amount)`), swap this for
 * proper ABI head/tail encoding. The wallet's signature over the EIP-1559
 * envelope is unchanged when that swap happens — only the inner `data`
 * bytes change.
 */
function encodePointerCall(op: CrossVmPointerOp): Uint8Array {
  const payload = JSON.stringify({
    fromSurface: op.fromSurface,
    toSurface: op.toSurface,
    owner: op.owner,
    amount: op.amount.toString(),
  });
  return new TextEncoder().encode(payload);
}

/**
 * Map an `EvmBody | EvmPointerBody` to the canonical `Eip1559Tx` shape the
 * RLP encoder consumes. Sends use `to = recipient, value = amount, data = ∅`.
 * Pointer ops use `to = 0x1003, value = 0, data = encoded payload`.
 */
function toEip1559(body: EvmBody | EvmPointerBody): Eip1559Tx {
  if (body.kind === 'evm-send') {
    return {
      chainId: body.chainId,
      nonce: body.nonce,
      maxPriorityFeePerGas: body.maxPriorityFeePerGas,
      maxFeePerGas: body.maxFeePerGas,
      gasLimit: body.gasLimit,
      to: body.to,
      value: body.value,
      data: new Uint8Array(0),
    };
  }
  return {
    chainId: body.chainId,
    nonce: body.nonce,
    maxPriorityFeePerGas: body.maxPriorityFeePerGas,
    maxFeePerGas: body.maxFeePerGas,
    gasLimit: body.gasLimit,
    // The precompile lives at the canonical address `0x1003` left-padded
    // to 20 bytes (Ethereum address width). Equivalent to
    // `0x0000000000000000000000000000000000001003`.
    to: '0x0000000000000000000000000000000000001003',
    value: 0n,
    data: body.data,
  };
}

/**
 * 32-byte EIP-1559 signing hash. Replaces the M1/M3.2 JSON canonicalize
 * placeholder. SigningDriver consumes this directly; secp256k1 signs over
 * the hash, not the pre-image.
 */
function canonicalize(body: EvmBody | EvmPointerBody): Uint8Array {
  return signingHash(toEip1559(body));
}

/**
 * Wire-format bytes the RPC submits. `0x02 || rlp(body || [yParity, r, s])`.
 * Driver-supplied signatures may be 65-byte r||s||v (legacy) or
 * (r, s, yParity) split — `splitSignature` normalises.
 */
function serializeForSubmit(body: EvmBody | EvmPointerBody, signature: Uint8Array): Uint8Array {
  return serializeSigned(toEip1559(body), splitSignature(signature));
}

function mockRpc(): NonNullable<EvmOnTenzroDeps['rpc']> {
  return {
    getNonce: async () => 0,
    getChainId: async () => 1337,
    estimateFees: async () => ({
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 100_000_000n,
    }),
    sendRawTransaction: async () => '0xmock',
  };
}
