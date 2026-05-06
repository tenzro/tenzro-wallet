/**
 * Tenzro native surface — the canonical TNZO ledger. Hybrid signing
 * (Ed25519 + ML-DSA-65) per https://tenzro.com/docs/wallet-sdk.
 *
 * M2 path (current):
 *   prepare → sign (local placeholder) → submit (server-side hybrid signing
 *   via `tenzro_signAndSendTransaction`, see TenzroRpcPort.sendTransaction).
 *
 * M5 path (future):
 *   sign() runs the FROST-Ed25519 device-leg with a passkey assertion;
 *   submit() sends the local share + assertion to the node, which combines
 *   with the TEE share and the ML-DSA leg. Same surface contract; the
 *   signing driver gets swapped under the kernel.
 *
 * The signing-driver call here is retained so the M1 mock test continues to
 * exercise the threshold-share collection abstraction. Its output is not
 * consumed by `submit()` in M2 (the node signs server-side); it will be
 * consumed in M5.
 */

import { type CrossVmPointerOp, dustResidual, truncateForView } from '../ports/cross-vm.ts';
import type { TenzroIdentityPort } from '../ports/tenzro-identity.ts';
import type { TenzroRpcPort, TenzroTxStatus } from '../ports/tenzro-rpc.ts';
import type { Consent } from '../types/consent.ts';
import type { SurfaceKey, TdipDid } from '../types/identity.ts';
import type { Intent, PreparedTx, SignedTx, TxHandle, TxStatus } from '../types/intent.ts';
import type { SigningDriver } from '../types/signing-driver.ts';
import type { SurfaceModule } from '../types/surface-module.ts';
import { makeHandle } from './util.ts';

interface TenzroNativeBody {
  readonly kind: 'tenzro-native-send';
  readonly from: TdipDid;
  readonly fromAddress: string;
  readonly toDid?: TdipDid;
  readonly toAddress: string;
  readonly amount: bigint;
  readonly assetSymbol: string;
  readonly nonce: number;
  readonly chainId: number;
}

/**
 * Cross-VM pointer op originating from the canonical Tenzro-native VM. The
 * native runtime exposes this as a `crossvm_pointer_move` syscall — the body
 * is structurally identical to a send except `kind` and that destination
 * is a surface tag, not an address. M3 stores the structured payload; the
 * server-side path on `submit()` already accepts this shape via the
 * existing `tenzro_signAndSendTransaction` envelope.
 */
interface TenzroNativePointerBody {
  readonly kind: 'tenzro-native-pointer';
  readonly from: TdipDid;
  readonly fromAddress: string;
  readonly nonce: number;
  readonly chainId: number;
  readonly pointer: CrossVmPointerOp;
}

export interface TenzroNativeDeps {
  /** Resolves the surface key (with on-chain address) for a given DID. */
  readonly keyResolver: (did: TdipDid) => SurfaceKey | undefined;
  readonly signingDriver: SigningDriver;
  /**
   * Tenzro RPC port. Real builds inject `TenzroSdkAdapter.fromClient(...)`;
   * tests inject an in-memory fake. Optional only because the M1 smoke tests
   * exercise the abstraction without a node — defaults to a stub that returns
   * deterministic placeholders.
   */
  readonly rpc?: TenzroRpcPort;
  /**
   * Optional remote identity port. Used only when a recipient DID is *not*
   * the user's own (i.e., not in `keyResolver`'s local cache). Without it,
   * sends to non-self DIDs throw — useful in tests and offline-first builds
   * where every DID is locally known.
   */
  readonly identityPort?: TenzroIdentityPort;
}

export function tenzroNativeSurface(deps: TenzroNativeDeps): SurfaceModule {
  const rpc = deps.rpc ?? stubRpc();

  return {
    name: 'tenzro-native',

    async prepare(intent: Intent): Promise<PreparedTx> {
      if (intent.kind !== 'send') {
        throw new Error(`unsupported intent on tenzro-native: ${intent.kind}`);
      }
      const fromKey = deps.keyResolver(intent.from);
      if (!fromKey || fromKey.surface !== 'tenzro-native') {
        throw new Error(`no tenzro-native key for ${intent.from}`);
      }
      const fromAddress = fromKey.address;
      const nonce = await rpc.getNonce(fromAddress);
      const chainId = await rpc.getChainId();
      const toAddress = await resolveRecipientAddress(
        intent.to,
        deps.keyResolver,
        deps.identityPort,
      );

      const body: TenzroNativeBody = {
        kind: 'tenzro-native-send',
        from: intent.from,
        fromAddress,
        ...(intent.to.kind === 'tdip' ? { toDid: intent.to.did } : {}),
        toAddress,
        amount: intent.amount,
        assetSymbol: intent.asset.symbol,
        nonce,
        chainId,
      };

      return {
        route: { kind: 'native', surface: 'tenzro-native' },
        intent,
        fees: [
          {
            asset: intent.asset,
            // M2: 21000 gas × 1 gwei placeholder; real estimate via
            // node-side gas oracle lands when the SDK exposes one.
            amount: 21_000n * 1_000_000_000n,
            label: 'tenzro gas',
          },
        ],
        etaMs: 500,
        reversibility: 'final-on-submit',
        warnings: [],
        body,
      };
    },

    async preparePointer(intent: Intent, op: CrossVmPointerOp): Promise<PreparedTx> {
      if (intent.kind !== 'send') {
        throw new Error(`unsupported intent on tenzro-native: ${intent.kind}`);
      }
      const fromKey = deps.keyResolver(intent.from);
      if (!fromKey || fromKey.surface !== 'tenzro-native') {
        throw new Error(`no tenzro-native key for ${intent.from}`);
      }
      const [nonce, chainId] = await Promise.all([rpc.getNonce(fromKey.address), rpc.getChainId()]);

      const body: TenzroNativePointerBody = {
        kind: 'tenzro-native-pointer',
        from: intent.from,
        fromAddress: fromKey.address,
        nonce,
        chainId,
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
          fromSurface: 'tenzro-native',
          toSurface: op.toSurface,
          precompile: '0x1003',
        },
        intent,
        fees: [
          {
            asset: intent.asset,
            amount: 21_000n * 1_000_000_000n,
            label: 'tenzro gas (pointer call)',
          },
        ],
        etaMs: 500,
        reversibility: 'final-on-submit',
        warnings,
        body,
      };
    },

    async sign(prepared: PreparedTx, _consent: Consent): Promise<SignedTx> {
      const body = prepared.body as TenzroNativeBody | TenzroNativePointerBody;
      const surfaceKey = deps.keyResolver(body.from);
      if (!surfaceKey || surfaceKey.surface !== 'tenzro-native') {
        throw new Error(`no tenzro-native key for ${body.from}`);
      }
      const preimage = canonicalize(body);
      // M2: the signing driver still runs (so the M1 test fixture keeps
      // working and the consent/policy gate stays at the kernel-level
      // sign() boundary). In M5 the driver becomes a real FROST-Ed25519
      // device-leg + passkey assertion, and `submit()` forwards that to
      // the node along with the canonical body for TEE-side completion.
      const result = await deps.signingDriver.sign({
        did: body.from,
        surfaceKey,
        scheme: 'ed25519+ml-dsa-65',
        preimage,
        purpose:
          body.kind === 'tenzro-native-pointer' ? 'tenzro-native-pointer' : 'tenzro-native-send',
      });
      return { prepared, signatures: result.signatures, body };
    },

    async submit(signed: SignedTx): Promise<TxHandle> {
      const body = signed.body as TenzroNativeBody | TenzroNativePointerBody;
      // M2: server-side hybrid signing path. The kernel's local signature
      // shares are not yet wire-bound; the SDK's DPoP-asserted session is
      // the auth boundary. M5 wires the local Ed25519 leg + passkey
      // assertion through to the node here.
      //
      // M3: pointer ops also flow through `sendTransaction` for now — the
      // node's RPC will branch on the body's `kind` to invoke the
      // `crossvm_pointer_move` syscall instead of value-transfer settlement.
      // When the SDK adds a dedicated pointer endpoint this branches.
      const sendArgs =
        body.kind === 'tenzro-native-pointer'
          ? {
              from: body.fromAddress,
              to: '0x1003',
              value: 0n,
              nonce: body.nonce,
              chainId: body.chainId,
            }
          : {
              from: body.fromAddress,
              to: body.toAddress,
              value: body.amount,
              nonce: body.nonce,
              chainId: body.chainId,
            };
      const hash = await rpc.sendTransaction(sendArgs);
      return makeHandle('tenzro-native', signed.prepared.intent, hash);
    },

    watch(handle: TxHandle): AsyncIterable<TxStatus> {
      return watchViaPort(handle, rpc);
    },
  };
}

// --- helpers ---

async function resolveRecipientAddress(
  to: Intent['to'],
  keyResolver: (did: TdipDid) => SurfaceKey | undefined,
  identityPort: TenzroIdentityPort | undefined,
): Promise<string> {
  switch (to.kind) {
    case 'tdip': {
      // Local-first: self-sends and any DID the kernel already knows about
      // resolve from the in-memory `SurfaceKey` map without a round-trip.
      const k = keyResolver(to.did);
      if (k && k.surface === 'tenzro-native') return k.address;
      // Remote: ask the identity port. This is where `resolveDidDocument`
      // happens in real builds; tests can leave the port unset to enforce
      // local-only resolution.
      if (!identityPort) {
        throw new Error(
          `cannot resolve tenzro-native address for recipient DID ${to.did}; ` +
            `no identity port wired (pass deps.identityPort to enable remote DID resolution)`,
        );
      }
      const remote = await identityPort.resolveTenzroAddress(to.did);
      if (!remote) {
        throw new Error(
          `DID ${to.did} has no tenzro-native key; cannot send to it on this surface`,
        );
      }
      return remote;
    }
    case 'evm':
      return to.address;
    case 'svm':
      return to.publicKey;
    case 'canton':
      return to.partyId;
  }
}

function canonicalize(body: TenzroNativeBody | TenzroNativePointerBody): Uint8Array {
  // Stable JSON canonicalization is fine for the M2 stub; the wire format
  // the chain actually verifies is `Transaction::hash()` per wallet-sdk
  // docs, but server-side signing means the node owns canonicalization.
  // Local canonicalization here only matters for the local signing-driver
  // leg (which is a placeholder until M5).
  const json = JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  return new TextEncoder().encode(json);
}

function stubRpc(): TenzroRpcPort {
  return {
    getNonce: async () => 0,
    getChainId: async () => 1337,
    sendTransaction: async () => '0xmock',
    getTransaction: async () => null,
  };
}

/**
 * Watch loop: yields one `created` status, then polls the node every
 * `intervalMs` and yields whenever the inferred status changes. Stops
 * after `finalized` or `failed`, or when `timeoutMs` elapses (yielding a
 * synthetic `dropped`).
 *
 * Defaults: 250ms poll, 60s timeout. Both can be overridden via the
 * `TENZRO_WATCH_INTERVAL_MS` / `TENZRO_WATCH_TIMEOUT_MS` env vars at
 * runtime — useful for smoke tests against slow testnets.
 */
async function* watchViaPort(handle: TxHandle, rpc: TenzroRpcPort): AsyncIterable<TxStatus> {
  const env = readEnv();
  const intervalMs = Number(env.TENZRO_WATCH_INTERVAL_MS ?? 250);
  const timeoutMs = Number(env.TENZRO_WATCH_TIMEOUT_MS ?? 60_000);

  yield { handle, phase: 'created' };
  if (handle.hash === undefined) {
    // No hash to poll for — surface produced a placeholder handle. Treat as
    // dropped immediately rather than spinning a doomed poll loop.
    yield { handle, phase: 'dropped', error: 'no transaction hash on handle' };
    return;
  }

  const deadline = Date.now() + timeoutMs;
  let lastPhase: TxStatus['phase'] = 'created';

  while (Date.now() < deadline) {
    let nodeStatus: TenzroTxStatus | null = null;
    try {
      nodeStatus = await rpc.getTransaction(handle.hash);
    } catch (err) {
      // Transient RPC errors don't kill the walk — they just fall through
      // to the next interval. M3+ may surface them as warnings.
      const message = err instanceof Error ? err.message : String(err);
      // Yielding a `failed` here would lie about the on-chain state; just
      // sleep and retry. If the issue is persistent we'll time out.
      void message;
    }

    const phase = mapStatusToPhase(nodeStatus);
    if (phase !== lastPhase) {
      lastPhase = phase;
      const update: TxStatus = {
        handle,
        phase,
        ...(handle.hash !== undefined ? { hash: handle.hash } : {}),
        ...(nodeStatus?.blockHeight !== undefined ? { blockHeight: nodeStatus.blockHeight } : {}),
      };
      yield update;
      if (phase === 'finalized' || phase === 'failed') return;
    }

    await sleep(intervalMs);
  }

  // Timed out without seeing finalization.
  yield {
    handle,
    phase: 'dropped',
    ...(handle.hash !== undefined ? { hash: handle.hash } : {}),
    error: `watch timed out after ${timeoutMs}ms`,
  };
}

function mapStatusToPhase(s: TenzroTxStatus | null): TxStatus['phase'] {
  if (s === null) return 'pending';
  switch (s.status) {
    case 'pending':
      return 'pending';
    case 'included':
      return 'confirmed';
    case 'finalized':
      return 'finalized';
    case 'failed':
      return 'failed';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Read env vars without requiring `@types/node`. Falls back to an empty
 * object in non-Node runtimes (browsers, web workers).
 */
function readEnv(): Record<string, string | undefined> {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env ?? {};
}
