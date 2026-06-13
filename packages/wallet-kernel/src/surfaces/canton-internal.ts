/**
 * Canton/Daml on the Tenzro-operated synchronizer.
 *
 * Same protocol as canton-external — Interactive Submission Service for
 * prepare/execute, completion-stream for watch — different validator and
 * different `synchronizerId`. Tenzro runs its own sequencer + mediator;
 * participants hosted on Tenzro infra connect to it; the asset model is a
 * Tenzro-local mirror of `Splice.Amulet` semantics, no Global Synchronizer
 * governance hooks.
 *
 * The two surfaces stay separate because:
 *   - The recipient mapping is different (`canton-internal` parties live
 *     on the Tenzro synchronizer, not GSN).
 *   - The asset symbol set is local (no CC, no SV economics).
 *   - The validator port is configured with a different ledger base URL.
 *
 * The implementation mirrors canton-external.ts; the kernel can choose to
 * factor the shared body out later if these stay 1:1, but keeping them
 * separate now lets us evolve them independently as the Tenzro internal
 * synchronizer's economics diverge from MainNet.
 */

import type {
  CantonValidatorPort,
  ExecuteSubmissionRequest,
  PrepareSubmissionRequest,
  PrepareSubmissionResponse,
} from '../ports/canton/canton-validator.ts';
import { bytesEqualConstantTime, preparedTransactionHash } from '../ports/canton/hash.ts';
import { verifyPreparedContent } from '../ports/canton/verify-content.ts';
import type { Consent } from '../types/consent.ts';
import type { CantonPartyKey, SurfaceKey, TdipDid } from '../types/identity.ts';
import type { Intent, PreparedTx, SignedTx, TxHandle, TxStatus } from '../types/intent.ts';
import type { SigningDriver } from '../types/signing-driver.ts';
import type { SurfaceModule } from '../types/surface-module.ts';
import { makeHandle } from './util.ts';

interface CantonInternalBody {
  readonly kind: 'canton-internal-send';
  readonly fromParty: string;
  readonly toParty: string;
  readonly amount: bigint;
  readonly assetSymbol: string;
  readonly description?: string;
  readonly trackingId: string;
  readonly synchronizerId: string;
  readonly preparedTransaction: Uint8Array;
  readonly preparedTransactionHash: Uint8Array;
}

export interface CantonInternalDeps {
  readonly keyResolver: (did: TdipDid) => SurfaceKey | undefined;
  readonly signingDriver: SigningDriver;
  /** Validator port, pointed at the Tenzro-operated synchronizer's validator. */
  readonly validatorPort: CantonValidatorPort;
  readonly userId: string;
}

export function cantonInternalSurface(deps: CantonInternalDeps): SurfaceModule {
  const port = deps.validatorPort;

  return {
    name: 'canton-internal',

    async prepare(intent: Intent): Promise<PreparedTx> {
      if (intent.kind !== 'send') throw new Error(`unsupported: ${intent.kind}`);
      if (intent.to.kind !== 'canton') {
        throw new Error('canton-internal requires a canton recipient');
      }
      const fromKey = deps.keyResolver(intent.from);
      if (!fromKey || fromKey.surface !== 'canton-internal') {
        throw new Error(`no canton-internal key for ${intent.from}`);
      }
      const trackingId = `tenzro-wallet-${Date.now()}`;

      const req: PrepareSubmissionRequest = {
        actAs: fromKey.partyId,
        synchronizerId: fromKey.synchronizerId,
        commandId: trackingId,
        // Tenzro-internal asset package. Aligned with the splice-amulet
        // semantics but published under a Tenzro-specific package id so
        // the two synchronizers' assets don't collide.
        packageIdSelectionPreference: 'tenzro-amulet:0.1.0',
        commands: [
          {
            _intent: 'tenzro-amulet-transfer',
            sender: fromKey.partyId,
            receiver: intent.to.partyId,
            amount: intent.amount,
            assetSymbol: intent.asset.symbol,
            ...(intent.memo !== undefined ? { description: intent.memo } : {}),
          },
        ],
      };
      const prepared = await port.prepareSubmission(req);
      assertHashingScheme(prepared);

      const body: CantonInternalBody = {
        kind: 'canton-internal-send',
        fromParty: fromKey.partyId,
        toParty: intent.to.partyId,
        amount: intent.amount,
        assetSymbol: intent.asset.symbol,
        ...(intent.memo !== undefined ? { description: intent.memo } : {}),
        trackingId,
        synchronizerId: fromKey.synchronizerId,
        preparedTransaction: prepared.preparedTransaction,
        preparedTransactionHash: prepared.preparedTransactionHash,
      };

      return {
        route: { kind: 'native', surface: 'canton-internal' },
        intent,
        // Tenzro-internal synchronizer charges a flat sync fee in the local
        // asset; surface-level fee modelling tracks canton-external for now.
        fees: [{ asset: intent.asset, amount: 0n, label: 'tenzro synchronizer fee' }],
        etaMs: 1500,
        reversibility: 'final-on-submit',
        warnings: [],
        body,
      };
    },

    async sign(prepared: PreparedTx, _consent: Consent): Promise<SignedTx> {
      const body = prepared.body as CantonInternalBody;
      const did = (prepared.intent as Extract<Intent, { kind: 'send' }>).from;
      const key = deps.keyResolver(did);
      if (!key || key.surface !== 'canton-internal') {
        throw new Error('missing canton-internal key at sign time');
      }
      const recomputed = await preparedTransactionHash(body.preparedTransaction);
      if (!bytesEqualConstantTime(recomputed, body.preparedTransactionHash)) {
        throw new Error('canton-internal: preparedTransactionHash mismatch — refusing to sign.');
      }
      verifyPreparedContent(body.preparedTransaction, {
        fromParty: body.fromParty,
        toParty: body.toParty,
        amount: body.amount,
        assetSymbol: body.assetSymbol,
      });
      const result = await deps.signingDriver.sign({
        did,
        surfaceKey: key,
        scheme: 'ed25519',
        preimage: recomputed,
        purpose: 'canton-internal-send',
      });
      return { prepared, signatures: result.signatures, body };
    },

    async submit(signed: SignedTx): Promise<TxHandle> {
      const body = signed.body as CantonInternalBody;
      const key = deps.keyResolver(
        (signed.prepared.intent as Extract<Intent, { kind: 'send' }>).from,
      );
      if (!key || key.surface !== 'canton-internal') {
        throw new Error('missing canton-internal key at submit time');
      }
      const req: ExecuteSubmissionRequest = {
        preparedTransaction: body.preparedTransaction,
        partySignatures: shapePartySignatures(key, signed.signatures),
        hashingSchemeVersion: 'HASHING_SCHEME_VERSION_V2',
        submissionId: body.trackingId,
      };
      await port.executeSubmission(req);
      return makeHandle('canton-internal', signed.prepared.intent, body.trackingId);
    },

    watch(handle: TxHandle): AsyncIterable<TxStatus> {
      return watchViaPort(handle, port, deps.userId);
    },
  };
}

function shapePartySignatures(
  key: CantonPartyKey,
  signatures: ReadonlyArray<Uint8Array>,
): ExecuteSubmissionRequest['partySignatures'] {
  if (signatures.length < key.threshold) {
    throw new Error(`canton-internal: need ${key.threshold} signatures, got ${signatures.length}`);
  }
  return signatures.slice(0, key.threshold).map((sig, i) => {
    const sk = key.signingKeys[i];
    if (!sk) throw new Error(`canton-internal: missing signing key at index ${i}`);
    return {
      party: key.partyId,
      signature: sig,
      scheme: sk.scheme,
      signedBy: sk.fingerprint,
    };
  });
}

function assertHashingScheme(r: PrepareSubmissionResponse): void {
  if (r.hashingSchemeVersion !== 'HASHING_SCHEME_VERSION_V2') {
    throw new Error(
      `canton-internal: unsupported hashing scheme ${r.hashingSchemeVersion}; ` +
        `kernel only knows V2`,
    );
  }
}

async function* watchViaPort(
  handle: TxHandle,
  port: CantonValidatorPort,
  userId: string,
): AsyncIterable<TxStatus> {
  yield { handle, phase: 'created' };
  yield { handle, phase: 'pending' };
  for await (const c of port.tailCompletions({
    userId,
    actAs: [handle.surface],
  })) {
    if (c.commandId !== handle.hash) continue;
    yield {
      handle: { ...handle, hash: c.updateId },
      phase: c.status === 'executed' ? 'confirmed' : 'failed',
      ...(c.errorMessage !== undefined ? { reason: c.errorMessage } : {}),
    };
    return;
  }
}
