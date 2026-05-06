/**
 * SVM surface inside the Tenzro runtime. SPL Token Adapter view of TNZO at
 * 9 decimals. Sub-lamport (sub-9-decimal) dust is truncated when crossing into
 * this view from EVM/native — the router surfaces a warning when applicable.
 */

import {
  type CompiledMessage,
  base58Decode,
  base58Encode,
  serializeCompiledMessage,
  serializeTransaction,
} from '../crypto/solana.ts';
import { type CrossVmPointerOp, dustResidual, truncateForView } from '../ports/cross-vm.ts';
import type { Consent } from '../types/consent.ts';
import type { SurfaceKey, TdipDid } from '../types/identity.ts';
import type { Intent, PreparedTx, SignedTx, TxHandle, TxStatus } from '../types/intent.ts';
import type { SigningDriver } from '../types/signing-driver.ts';
import type { SurfaceModule } from '../types/surface-module.ts';
import { makeHandle, mockStatusWalk } from './util.ts';

interface SvmBody {
  readonly kind: 'svm-send';
  readonly fromPubkey: string;
  readonly toPubkey: string;
  /** Amount in lamports (9-decimal). */
  readonly lamports: bigint;
  readonly recentBlockhash: string;
}

/**
 * Cross-VM pointer op originating on the SVM side. On Solana-on-Tenzro this
 * is a `tenzro_cross_vm` system program instruction; the message compiler
 * builds a single-ix tx targeting that program. The Tenzro program ID for
 * `tenzro_cross_vm` is the canonical placeholder address until the
 * SVM-on-Tenzro spec publishes a real one — see `TENZRO_CROSS_VM_PROGRAM_ID`.
 */
interface SvmPointerBody {
  readonly kind: 'svm-pointer';
  readonly fromPubkey: string;
  readonly recentBlockhash: string;
  readonly pointer: CrossVmPointerOp;
}

/**
 * Placeholder program ID (32 bytes, base58 of all-zeros + last byte = 3) for
 * `tenzro_cross_vm`. The real address is gated on the SVM-on-Tenzro spec
 * publishing the canonical program ID — when it does, swap in those bytes.
 * Documentation TODO at https://tenzro.com/docs/cross-vm-tokens.
 */
const TENZRO_CROSS_VM_PROGRAM_ID: Uint8Array = (() => {
  const b = new Uint8Array(32);
  b[31] = 0x03; // sentinel — distinct from System Program (all zeros)
  return b;
})();

export interface SvmOnTenzroDeps {
  readonly keyResolver: (did: TdipDid) => SurfaceKey | undefined;
  readonly signingDriver: SigningDriver;
  readonly rpc?: {
    /** Returns a base58-encoded 32-byte recent blockhash. */
    getRecentBlockhash(): Promise<string>;
    /**
     * Broadcast wire-format bytes (compact-array(sigs) || compiled-message)
     * and return the base58 transaction signature (SVM uses the first sig
     * as the tx id). Maps to `sendTransaction` on Solana JSON-RPC.
     */
    sendRawTransaction(rawTx: Uint8Array): Promise<string>;
  };
}

export function svmOnTenzroSurface(deps: SvmOnTenzroDeps): SurfaceModule {
  const rpc = deps.rpc ?? mockRpc();

  return {
    name: 'svm-on-tenzro',

    async prepare(intent: Intent): Promise<PreparedTx> {
      if (intent.kind !== 'send') throw new Error(`unsupported: ${intent.kind}`);
      if (intent.to.kind !== 'svm') throw new Error('svm-on-tenzro requires an SVM recipient');
      const fromKey = deps.keyResolver(intent.from);
      if (!fromKey || fromKey.surface !== 'svm-on-tenzro') {
        throw new Error(`no svm-on-tenzro key for ${intent.from}`);
      }
      const recentBlockhash = await rpc.getRecentBlockhash();

      const lamports = toLamports(intent.amount, intent.asset.decimals);
      const dustTruncated = fromLamports(lamports, intent.asset.decimals) !== intent.amount;

      const body: SvmBody = {
        kind: 'svm-send',
        fromPubkey: fromKey.address,
        toPubkey: intent.to.publicKey,
        lamports,
        recentBlockhash,
      };

      return {
        route: { kind: 'native', surface: 'svm-on-tenzro' },
        intent,
        fees: [{ asset: intent.asset, amount: 5000n, label: 'solana-style fee (lamports)' }],
        etaMs: 800,
        reversibility: 'final-on-submit',
        warnings: dustTruncated
          ? ['amount truncated to 9-decimal precision (sub-lamport dust dropped)']
          : [],
        body,
      };
    },

    async preparePointer(intent: Intent, op: CrossVmPointerOp): Promise<PreparedTx> {
      if (intent.kind !== 'send') throw new Error(`unsupported: ${intent.kind}`);
      const fromKey = deps.keyResolver(intent.from);
      if (!fromKey || fromKey.surface !== 'svm-on-tenzro') {
        throw new Error(`no svm-on-tenzro key for ${intent.from}`);
      }
      const recentBlockhash = await rpc.getRecentBlockhash();

      const body: SvmPointerBody = {
        kind: 'svm-pointer',
        fromPubkey: fromKey.address,
        recentBlockhash,
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
          fromSurface: 'svm-on-tenzro',
          toSurface: op.toSurface,
          precompile: '0x1003',
        },
        intent,
        fees: [{ asset: intent.asset, amount: 5000n, label: 'solana-style fee (lamports)' }],
        etaMs: 800,
        reversibility: 'final-on-submit',
        warnings,
        body,
      };
    },

    async sign(prepared: PreparedTx, _consent: Consent): Promise<SignedTx> {
      const body = prepared.body as SvmBody | SvmPointerBody;
      const did = (prepared.intent as Extract<Intent, { kind: 'send' }>).from;
      const key = deps.keyResolver(did);
      if (!key || key.surface !== 'svm-on-tenzro') {
        throw new Error('missing svm key at sign time');
      }
      const preimage = canonicalize(body);
      const result = await deps.signingDriver.sign({
        did,
        surfaceKey: key,
        scheme: 'ed25519',
        preimage,
        purpose: body.kind === 'svm-pointer' ? 'svm-pointer' : 'svm-send',
      });
      return { prepared, signatures: result.signatures, body };
    },

    async submit(signed: SignedTx): Promise<TxHandle> {
      const body = signed.body as SvmBody | SvmPointerBody;
      const sig = signed.signatures[0];
      if (!sig) throw new Error('missing signature');
      const message = compileMessage(body);
      const rawTx = serializeTransaction(message, [sig]);
      const txSig = await rpc.sendRawTransaction(rawTx);
      return makeHandle('svm-on-tenzro', signed.prepared.intent, txSig);
    },

    watch(handle: TxHandle): AsyncIterable<TxStatus> {
      return mockStatusWalk(handle);
    },
  };
}

function toLamports(amount: bigint, decimals: number): bigint {
  if (decimals === 9) return amount;
  if (decimals > 9) {
    const div = 10n ** BigInt(decimals - 9);
    return amount / div;
  }
  const mul = 10n ** BigInt(9 - decimals);
  return amount * mul;
}

function fromLamports(lamports: bigint, decimals: number): bigint {
  if (decimals === 9) return lamports;
  if (decimals > 9) return lamports * 10n ** BigInt(decimals - 9);
  return lamports / 10n ** BigInt(9 - decimals);
}

/**
 * Canonical signing pre-image for an SVM transaction is the *compiled message
 * bytes themselves*. Ed25519 (RFC 8032) hashes internally, so unlike EVM we
 * do NOT pre-hash here — feeding the message bytes to the SigningDriver is
 * what `solana-validator` will recompute and verify against `accountKeys[0]`.
 */
function canonicalize(body: SvmBody | SvmPointerBody): Uint8Array {
  return serializeCompiledMessage(compileMessage(body));
}

/**
 * Compile the structured tx body into a Solana legacy `CompiledMessage`.
 *
 * For `svm-send`: signer is the fee payer + sender (`fromPubkey`); recipient
 * is a non-signer; the System Program (all-zeros pubkey) is the program; the
 * single instruction is a System Program transfer with little-endian u64
 * lamports.
 *
 * For `svm-pointer`: signer is the fee payer (`fromPubkey`); program is
 * `TENZRO_CROSS_VM_PROGRAM_ID`; data is the structured payload (placeholder
 * JSON until the program's instruction discriminator is published).
 */
function compileMessage(body: SvmBody | SvmPointerBody): CompiledMessage {
  if (body.kind === 'svm-send') {
    const from = base58Decode(body.fromPubkey);
    const to = base58Decode(body.toPubkey);
    const sysProgram = new Uint8Array(32); // 11111…11
    return {
      numRequiredSignatures: 1,
      numReadonlySignedAccounts: 0,
      // Recipient is writable (sees value increase) but not a signer; program
      // is read-only and not a signer.
      numReadonlyUnsignedAccounts: 1,
      // Solana ordering: signers first, then writable non-signers, then
      // read-only non-signers. So [from, to, sysProgram].
      accountKeys: [from, to, sysProgram],
      recentBlockhash: base58Decode(body.recentBlockhash),
      instructions: [
        {
          programIdIndex: 2, // sysProgram
          accountKeyIndices: [0, 1], // from, to
          data: encodeSystemTransfer(body.lamports),
        },
      ],
    };
  }

  // pointer op
  const from = base58Decode(body.fromPubkey);
  return {
    numRequiredSignatures: 1,
    numReadonlySignedAccounts: 0,
    numReadonlyUnsignedAccounts: 1, // program is read-only
    accountKeys: [from, TENZRO_CROSS_VM_PROGRAM_ID],
    recentBlockhash: base58Decode(body.recentBlockhash),
    instructions: [
      {
        programIdIndex: 1, // tenzro_cross_vm
        accountKeyIndices: [0], // signer
        // Placeholder until the program publishes its instruction
        // discriminator. The wire path that wraps and signs this is real;
        // only the inner bytes are TBD.
        data: new TextEncoder().encode(
          JSON.stringify({
            toSurface: body.pointer.toSurface,
            owner: body.pointer.owner,
            amount: body.pointer.amount.toString(),
          }),
        ),
      },
    ],
  };
}

/**
 * Solana System Program `Transfer` instruction:
 *   layout: u32 instruction_index (= 2 for transfer) || u64 LE lamports
 */
function encodeSystemTransfer(lamports: bigint): Uint8Array {
  const out = new Uint8Array(12);
  // instruction = 2 (Transfer), little-endian u32
  out[0] = 2;
  // lamports, little-endian u64
  let v = lamports;
  for (let i = 0; i < 8; i++) {
    out[4 + i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Mock RPC used when no real Solana port is injected. Returns deterministic
 * placeholders shaped like real Solana wire types (32-byte blockhash
 * base58-encoded, fixed tx-signature string).
 */
function mockRpc(): NonNullable<SvmOnTenzroDeps['rpc']> {
  const blockhash = base58Encode(new Uint8Array(32).fill(0x01));
  return {
    getRecentBlockhash: async () => blockhash,
    sendRawTransaction: async () => 'mocksig',
  };
}
