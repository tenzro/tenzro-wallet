/**
 * Tenzro native surface — TNZO on the Tenzro Ledger, from a person's passkey
 * account.
 *
 *   prepare  builds a native `Transfer` from the account, priced at the
 *            node's gas price;
 *   sign     a passkey the account's keystore links signs the transaction
 *            digest on the device (user verification required); the nonce,
 *            chain id and signing payload come from the node and the payload
 *            is checked to be the transaction built;
 *   submit   `tenzro_sendRawTransaction`;
 *   watch    `eth_getTransactionReceipt`.
 *
 * The node never holds a key for the account and never signs for it; the
 * transfer moves value only in consensus.
 */

import type { HybridSigner, SignedTransactionJson, TypedTransaction } from 'tenzro-sdk';

import { fromHex, toHex } from '../custody/passkey/bytes.ts';
import type { TenzroIdentityPort } from '../ports/tenzro-identity.ts';
import type { TenzroRpcPort, TransactionReceipt } from '../ports/tenzro-rpc.ts';
import type { Consent } from '../types/consent.ts';
import type { SurfaceKey, TdipDid } from '../types/identity.ts';
import type { Intent, PreparedTx, SignedTx, TxHandle, TxStatus } from '../types/intent.ts';
import type { SurfaceModule } from '../types/surface-module.ts';
import { makeHandle } from './util.ts';

interface TenzroNativeBody {
  readonly kind: 'tenzro-native-transfer';
  readonly from: TdipDid;
  readonly fromAddress: string;
  readonly toDid?: TdipDid;
  readonly toAddress: string;
  readonly amount: bigint;
  readonly assetSymbol: string;
  readonly tx: TypedTransaction;
}

/** Gas a plain transfer reserves. */
export const DEFAULT_TRANSFER_GAS = 500_000;

export interface TenzroNativeDeps {
  /** Resolves the surface key (the passkey account) for a given DID. */
  readonly keyResolver: (did: TdipDid) => SurfaceKey | undefined;
  /**
   * The signer for transactions from the DID's account: a passkey its
   * keystore links, normally `custody.transactionSigner(account)`.
   */
  readonly transactionSigner: (did: TdipDid) => Promise<HybridSigner>;
  /** Real builds inject `TenzroJsonRpcAdapter`; tests inject a fake. */
  readonly rpc: TenzroRpcPort;
  /**
   * Optional remote identity port, used when a recipient DID is not the
   * user's own. Without it, sends to other DIDs throw.
   */
  readonly identityPort?: TenzroIdentityPort;
  /** Gas limit for a transfer. */
  readonly gasLimit?: number;
  /** Receipt polling. Defaults: 500 ms interval, 60 s timeout. */
  readonly watch?: { readonly intervalMs?: number; readonly timeoutMs?: number };
}

export function tenzroNativeSurface(deps: TenzroNativeDeps): SurfaceModule {
  const rpc = deps.rpc;
  const gasLimit = deps.gasLimit ?? DEFAULT_TRANSFER_GAS;

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
      const toAddress = ledgerSlot(
        await resolveRecipientAddress(intent.to, deps.keyResolver, deps.identityPort),
      );
      if (toAddress === ledgerSlot(fromKey.address)) {
        throw new Error('cannot send to your own account');
      }
      const gasPrice = await rpc.getGasPrice();
      const tx: TypedTransaction = {
        kind: 'Transfer',
        fields: {
          amount:
            intent.amount <= BigInt(Number.MAX_SAFE_INTEGER)
              ? Number(intent.amount)
              : intent.amount.toString(),
        },
        to: toAddress,
        from: fromKey.address,
        gasLimit,
        gasPrice: Number(gasPrice),
      };
      const body: TenzroNativeBody = {
        kind: 'tenzro-native-transfer',
        from: intent.from,
        fromAddress: fromKey.address,
        ...(intent.to.kind === 'tdip' ? { toDid: intent.to.did } : {}),
        toAddress,
        amount: intent.amount,
        assetSymbol: intent.asset.symbol,
        tx,
      };
      return {
        route: { kind: 'native', surface: 'tenzro-native' },
        intent,
        fees: [
          {
            asset: intent.asset,
            amount: BigInt(gasLimit) * gasPrice,
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
      const signer = await deps.transactionSigner(body.from);
      const signed = await rpc.signTransaction(signer, body.tx);
      return {
        prepared,
        signatures: [new TextEncoder().encode(JSON.stringify(signed.signature))],
        body: { ...body, signed },
      };
    },

    async submit(signed: SignedTx): Promise<TxHandle> {
      const body = signed.body as TenzroNativeBody & { signed?: SignedTransactionJson };
      if (!body.signed) throw new Error('the transfer is not signed');
      const hash = await rpc.sendTransaction(body.signed);
      return makeHandle('tenzro-native', signed.prepared.intent, hash);
    },

    watch(handle: TxHandle): AsyncIterable<TxStatus> {
      return watchReceipt(handle, rpc, deps.watch ?? {});
    },
  };
}

// --- helpers ---

/** A Tenzro account in its 32-byte ledger slot, `0x` hex: a 20-byte address is widened on the right. */
function ledgerSlot(address: string): string {
  const bytes = fromHex(address);
  if (bytes.length === 32) return toHex(bytes, true);
  if (bytes.length === 20) {
    const slot = new Uint8Array(32);
    slot.set(bytes);
    return toHex(slot, true);
  }
  throw new Error(`recipient ${address} is not a 20- or 32-byte account address`);
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
    yield { handle, phase: 'dropped', error: 'no transaction hash on handle' };
    return;
  }
  yield { handle, phase: 'pending', hash: handle.hash };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let receipt: TransactionReceipt | null = null;
    try {
      receipt = await rpc.getTransactionReceipt(handle.hash);
    } catch {
      // Transient RPC errors fall through to the next interval.
    }
    if (receipt) {
      yield receipt.success
        ? { handle, phase: 'finalized', hash: handle.hash }
        : { handle, phase: 'failed', hash: handle.hash, error: 'transaction failed' };
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
