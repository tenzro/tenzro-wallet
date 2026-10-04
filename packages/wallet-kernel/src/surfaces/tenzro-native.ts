/**
 * Tenzro native surface — TNZO on the Tenzro Ledger, from a person's passkey
 * smart account.
 *
 *   prepare  builds an ERC-4337 v0.8 UserOperation calling the account's
 *            `execute(to, value, data)`, with the nonce, gas price, chain id
 *            and EntryPoint read from the node, and computes its hash;
 *   sign     hands the 32-byte hash to the signing driver: the passkey signs
 *            it on the device (user verification required);
 *   submit   `eth_sendUserOperation`;
 *   watch    `eth_getUserOperationReceipt`.
 *
 * The node never holds a key for the account and never signs for it.
 */

import { fromHex, toHex } from '../custody/passkey/bytes.ts';
import {
  DEFAULT_USER_OP_GAS,
  type UserOperation,
  encodeExecuteCall,
  userOperationHash,
  userOperationToJson,
} from '../custody/passkey/userop.ts';
import type { TenzroIdentityPort } from '../ports/tenzro-identity.ts';
import type { TenzroRpcPort, UserOperationReceipt } from '../ports/tenzro-rpc.ts';
import type { Consent } from '../types/consent.ts';
import type { SurfaceKey, TdipDid } from '../types/identity.ts';
import type { Intent, PreparedTx, SignedTx, TxHandle, TxStatus } from '../types/intent.ts';
import type { SigningDriver } from '../types/signing-driver.ts';
import type { SurfaceModule } from '../types/surface-module.ts';
import { makeHandle } from './util.ts';

interface TenzroNativeBody {
  readonly kind: 'tenzro-native-userop';
  readonly from: TdipDid;
  readonly fromAddress: string;
  readonly toDid?: TdipDid;
  readonly toAddress: string;
  readonly amount: bigint;
  readonly assetSymbol: string;
  readonly chainId: bigint;
  readonly entryPoint: string;
  readonly userOp: UserOperation;
  /** The hash the passkey signs, `0x` hex. */
  readonly userOpHash: string;
}

export interface TenzroNativeDeps {
  /** Resolves the surface key (the passkey smart account) for a given DID. */
  readonly keyResolver: (did: TdipDid) => SurfaceKey | undefined;
  /** Normally `passkeySigningDriver(...)`. */
  readonly signingDriver: SigningDriver;
  /** Real builds inject `TenzroJsonRpcAdapter`; tests inject a fake. */
  readonly rpc: TenzroRpcPort;
  /**
   * Optional remote identity port, used when a recipient DID is not the
   * user's own. Without it, sends to other DIDs throw.
   */
  readonly identityPort?: TenzroIdentityPort;
  /** Gas limits for the operation. Defaults suit a plain value transfer. */
  readonly gas?: Partial<typeof DEFAULT_USER_OP_GAS>;
  /** Receipt polling. Defaults: 500 ms interval, 60 s timeout. */
  readonly watch?: { readonly intervalMs?: number; readonly timeoutMs?: number };
}

export function tenzroNativeSurface(deps: TenzroNativeDeps): SurfaceModule {
  const rpc = deps.rpc;
  const gas = { ...DEFAULT_USER_OP_GAS, ...(deps.gas ?? {}) };

  return {
    name: 'tenzro-native',

    async prepare(intent: Intent): Promise<PreparedTx> {
      if (intent.kind !== 'send') {
        throw new Error(`unsupported intent on tenzro-native: ${intent.kind}`);
      }
      const fromKey = deps.keyResolver(intent.from);
      if (!fromKey || fromKey.surface !== 'tenzro-native') {
        throw new Error(`no tenzro-native account for ${intent.from}`);
      }
      const toAddress = executeTarget(
        await resolveRecipientAddress(intent.to, deps.keyResolver, deps.identityPort),
      );
      if (toAddress === normalizeAddress(fromKey.address)) {
        throw new Error('cannot send to your own account');
      }
      const [nonce, chainId, entryPoint, gasPrice] = await Promise.all([
        rpc.getAccountNonce(fromKey.address),
        rpc.getChainId(),
        rpc.getEntryPoint(),
        rpc.getGasPrice(),
      ]);

      const userOp: UserOperation = {
        sender: fromKey.address,
        nonce,
        callData: encodeExecuteCall(toAddress, intent.amount),
        callGasLimit: gas.callGasLimit,
        verificationGasLimit: gas.verificationGasLimit,
        preVerificationGas: gas.preVerificationGas,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice,
      };
      const hash = userOperationHash(userOp, chainId, entryPoint);

      const body: TenzroNativeBody = {
        kind: 'tenzro-native-userop',
        from: intent.from,
        fromAddress: fromKey.address,
        ...(intent.to.kind === 'tdip' ? { toDid: intent.to.did } : {}),
        toAddress,
        amount: intent.amount,
        assetSymbol: intent.asset.symbol,
        chainId,
        entryPoint,
        userOp,
        userOpHash: toHex(hash, true),
      };

      return {
        route: { kind: 'native', surface: 'tenzro-native' },
        intent,
        fees: [
          {
            asset: intent.asset,
            amount:
              (gas.callGasLimit + gas.verificationGasLimit + gas.preVerificationGas) * gasPrice,
            label: 'network fee (maximum)',
          },
        ],
        etaMs: 2_000,
        reversibility: 'final-on-submit',
        warnings: [],
        body,
      };
    },

    async sign(prepared: PreparedTx, _consent: Consent): Promise<SignedTx> {
      const body = prepared.body as TenzroNativeBody;
      const surfaceKey = deps.keyResolver(body.from);
      if (!surfaceKey || surfaceKey.surface !== 'tenzro-native') {
        throw new Error(`no tenzro-native account for ${body.from}`);
      }
      const result = await deps.signingDriver.sign({
        did: body.from,
        surfaceKey,
        scheme: 'webauthn-p256',
        preimage: fromHex(body.userOpHash),
        purpose: 'tenzro-native-send',
      });
      const bundle = result.signatures[0];
      if (!bundle || result.signatures.length !== 1) {
        throw new Error('the signing driver must return one signature bundle');
      }
      return { prepared, signatures: [bundle], body };
    },

    async submit(signed: SignedTx): Promise<TxHandle> {
      const body = signed.body as TenzroNativeBody;
      const signature = signed.signatures[0];
      if (!signature) throw new Error('missing signature bundle');
      const op = userOperationToJson({ ...body.userOp, signature });
      const hash = await rpc.sendUserOperation(op, body.entryPoint);
      return makeHandle('tenzro-native', signed.prepared.intent, hash);
    },

    watch(handle: TxHandle): AsyncIterable<TxStatus> {
      return watchReceipt(handle, rpc, deps.watch ?? {});
    },
  };
}

// --- helpers ---

const normalizeAddress = (a: string): string => toHex(fromHex(a), true);

/**
 * `execute` takes a 20-byte address. Tenzro addresses may arrive widened to
 * 32 bytes with 12 leading zero bytes; anything else is not reachable from
 * an account call.
 */
function executeTarget(address: string): string {
  const bytes = fromHex(address);
  if (bytes.length === 20) return toHex(bytes, true);
  if (bytes.length === 32 && bytes.slice(0, 12).every((b) => b === 0)) {
    return toHex(bytes.slice(12), true);
  }
  throw new Error(`recipient ${address} is not a 20-byte account address`);
}

async function resolveRecipientAddress(
  to: Intent['to'],
  keyResolver: (did: TdipDid) => SurfaceKey | undefined,
  identityPort: TenzroIdentityPort | undefined,
): Promise<string> {
  switch (to.kind) {
    case 'tdip': {
      const k = keyResolver(to.did);
      if (k && k.surface === 'tenzro-native') return k.address;
      if (!identityPort) {
        throw new Error(
          `cannot resolve a Tenzro address for ${to.did}; ` +
            'pass deps.identityPort to resolve other identities',
        );
      }
      const remote = await identityPort.resolveTenzroAddress(to.did);
      if (!remote) throw new Error(`DID ${to.did} has no Tenzro account`);
      return remote;
    }
    case 'evm':
      return to.address;
    case 'svm':
    case 'canton':
      throw new Error(`a ${to.kind} recipient is not reachable on the tenzro-native surface`);
  }
}

async function* watchReceipt(
  handle: TxHandle,
  rpc: TenzroRpcPort,
  opts: { readonly intervalMs?: number; readonly timeoutMs?: number },
): AsyncIterable<TxStatus> {
  const intervalMs = opts.intervalMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  yield { handle, phase: 'created' };
  if (handle.hash === undefined) {
    yield { handle, phase: 'dropped', error: 'no operation hash on handle' };
    return;
  }
  yield { handle, phase: 'pending', hash: handle.hash };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let receipt: UserOperationReceipt | null = null;
    try {
      receipt = await rpc.getUserOperationReceipt(handle.hash);
    } catch {
      // Transient RPC errors fall through to the next interval.
    }
    if (receipt) {
      yield receipt.success
        ? { handle, phase: 'finalized', hash: handle.hash }
        : { handle, phase: 'failed', hash: handle.hash, error: 'operation reverted' };
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  yield {
    handle,
    phase: 'dropped',
    hash: handle.hash,
    error: `no receipt after ${timeoutMs}ms`,
  };
}
