/**
 * Canton Network MainNet surface — Tenzro hosts the validator; the user's
 * canton-external party signs locally and the validator dispatches to the
 * Global Synchronizer.
 *
 * Protocol shape (per DESIGN.md §4.5):
 *   - prepare → ask the validator's Interactive Submission Service for a
 *     `PreparedTransaction` proto + canonical hash.
 *   - sign → recompute the hash locally (SHA-256 with Canton hash purpose 11
 *     prefix, `HASHING_SCHEME_VERSION_V2`), constant-time-compare with the
 *     validator's hash, then sign that hash via the SigningDriver. The
 *     equality assertion is the wallet's only defence against a malicious
 *     validator — without it, signing the validator-supplied hash trusts
 *     the validator on what's being authorised.
 *   - submit → `executeSubmission` with the signed hash; the validator
 *     dispatches to the synchronizer.
 *   - watch → tail `tailCompletions` filtered to this command id.
 *
 * The PreparedTransaction proto's content-level decode (re-deriving the
 * user-visible fields from the proto and comparing them to `intent`) is
 * deferred — see DESIGN.md §11 open question #5. Hash equality alone is
 * sufficient to bind signature → exact bytes; content decode is a defence
 * against a validator that returns *valid* bytes for the *wrong* transaction.
 * We accept that gap until the proto schema lands in the kernel.
 */

import type {
  CantonValidatorPort,
  ExecuteSubmissionRequest,
  PrepareSubmissionRequest,
  PrepareSubmissionResponse,
} from '../ports/canton/canton-validator.ts';
import { bytesEqualConstantTime, preparedTransactionHash } from '../ports/canton/hash.ts';
import type { Consent } from '../types/consent.ts';
import type { CantonPartyKey, SurfaceKey, TdipDid } from '../types/identity.ts';
import type { Intent, PreparedTx, SignedTx, TxHandle, TxStatus } from '../types/intent.ts';
import type { SigningDriver } from '../types/signing-driver.ts';
import type { SurfaceModule } from '../types/surface-module.ts';
import { makeHandle } from './util.ts';

interface CantonExternalBody {
  readonly kind: 'canton-external-send';
  readonly fromParty: string;
  readonly toParty: string;
  readonly amount: bigint;
  readonly assetSymbol: string;
  /** Memo. On the wire this is the `description` field on `AmuletRules_Transfer`. */
  readonly description?: string;
  readonly trackingId: string;
  readonly viaPreapproval: boolean;
  readonly synchronizerId: string;
  /** PreparedTransaction proto bytes from the validator. The wallet does
   *  NOT generate these — `prepareSubmission` returns them. */
  readonly preparedTransaction: Uint8Array;
  readonly preparedTransactionHash: Uint8Array;
}

export interface CantonExternalDeps {
  readonly keyResolver: (did: TdipDid) => SurfaceKey | undefined;
  readonly signingDriver: SigningDriver;
  /**
   * Validator port. The kernel owns the adapter wiring (typically
   * `LedgerApiAdapter`) and threads it through here. The surface module
   * never constructs the port itself — keeps test injection clean.
   */
  readonly validatorPort: CantonValidatorPort;
  /** User id to thread into completion filters (Canton needs `user_id`). */
  readonly userId: string;
}

export function cantonExternalSurface(deps: CantonExternalDeps): SurfaceModule {
  const port = deps.validatorPort;

  return {
    name: 'canton-external',

    memoSpec() {
      // Canton's transfer description is a free-form text field, optional
      // (the network credits without it), capped at 256 chars to keep the
      // CC `Numeric 10` payload + description under the standard transfer-
      // command size budget. Per DESIGN.md §11.9, this is the canonical
      // example surfaces follow.
      return {
        kind: 'text',
        required: false,
        maxLength: 256,
        label: 'Transfer description',
      };
    },

    async prepare(intent: Intent): Promise<PreparedTx> {
      if (intent.kind !== 'send') throw new Error(`unsupported: ${intent.kind}`);
      if (intent.to.kind !== 'canton') {
        throw new Error('canton-external requires a canton recipient');
      }
      const fromKey = deps.keyResolver(intent.from);
      if (!fromKey || fromKey.surface !== 'canton-external') {
        throw new Error(`no canton-external key for ${intent.from}`);
      }
      const trackingId = `tenzro-wallet-${Date.now()}`;

      // Two-path routing: if the recipient has a TransferPreapproval, use the
      // one-step `TransferPreapproval_Send` path (atomic, final on commit).
      // Otherwise fall back to the Token Standard two-step (TransferOffer
      // / accept). Tenzro pre-creates preapprovals during external-party
      // onboarding, so the preapproval path is the common case — but the
      // recipient may be a non-Tenzro Canton party.
      const preapproval = await port.lookupPreapproval(intent.to.partyId);
      const viaPreapproval = preapproval !== null;

      const req: PrepareSubmissionRequest = {
        actAs: fromKey.partyId,
        synchronizerId: fromKey.synchronizerId,
        commandId: trackingId,
        // Pinned package id per DESIGN.md §4.5.3. Post-2026-05-05 baseline:
        // `splice-amulet 0.1.17` on the Tenzro validator.
        packageIdSelectionPreference: 'splice-amulet:0.1.17',
        commands: shapeAmuletTransfer({
          from: fromKey.partyId,
          to: intent.to.partyId,
          amount: intent.amount,
          assetSymbol: intent.asset.symbol,
          memo: intent.memo,
          viaPreapproval,
          ...(preapproval !== null ? { preapprovalContractId: preapproval.contractId } : {}),
        }),
      };
      const prepared = await port.prepareSubmission(req);
      assertHashingScheme(prepared);

      const body: CantonExternalBody = {
        kind: 'canton-external-send',
        fromParty: fromKey.partyId,
        toParty: intent.to.partyId,
        amount: intent.amount,
        assetSymbol: intent.asset.symbol,
        ...(intent.memo !== undefined ? { description: intent.memo } : {}),
        trackingId,
        viaPreapproval,
        synchronizerId: fromKey.synchronizerId,
        preparedTransaction: prepared.preparedTransaction,
        preparedTransactionHash: prepared.preparedTransactionHash,
      };

      return {
        route: { kind: 'native', surface: 'canton-external' },
        intent,
        // Canton fees aren't paid in CC at the wallet level — they're SV
        // reward economics under the hood. Display-only zero is fine here;
        // the validator response carries the actual cost in CC if needed.
        fees: [{ asset: intent.asset, amount: 0n, label: 'canton mainnet sync fee' }],
        // Two-step (Token Standard) is held as `pending` on the receiver's
        // side until acceptance; preapproval is atomic. Reflect the latency
        // delta in `etaMs`.
        etaMs: viaPreapproval ? 2000 : 8000,
        reversibility: viaPreapproval ? 'final-on-submit' : 'reversible-until-confirmed',
        warnings: [],
        body,
      };
    },

    async sign(prepared: PreparedTx, _consent: Consent): Promise<SignedTx> {
      const body = prepared.body as CantonExternalBody;
      const did = (prepared.intent as Extract<Intent, { kind: 'send' }>).from;
      const key = deps.keyResolver(did);
      if (!key || key.surface !== 'canton-external') {
        throw new Error('missing canton-external key at sign time');
      }
      // Recompute the hash from the proto bytes the validator returned and
      // assert it matches what the validator claims is the hash. Without
      // this check the wallet trusts the validator on what it's signing —
      // defeats external signing.
      const recomputed = await preparedTransactionHash(body.preparedTransaction);
      if (!bytesEqualConstantTime(recomputed, body.preparedTransactionHash)) {
        throw new Error(
          'canton-external: preparedTransactionHash mismatch — refusing to sign. ' +
            'Either the validator is malicious or the proto bytes were corrupted in transit.',
        );
      }
      const result = await deps.signingDriver.sign({
        did,
        surfaceKey: key,
        scheme: 'ed25519',
        // Sign the recomputed hash, not the validator-supplied one. They're
        // equal by the assertion above; using the recomputed one removes the
        // last byte of trust in the validator's response.
        preimage: recomputed,
        purpose: 'canton-external-send',
      });
      return { prepared, signatures: result.signatures, body };
    },

    async submit(signed: SignedTx): Promise<TxHandle> {
      const body = signed.body as CantonExternalBody;
      const key = deps.keyResolver(
        (signed.prepared.intent as Extract<Intent, { kind: 'send' }>).from,
      );
      if (!key || key.surface !== 'canton-external') {
        throw new Error('missing canton-external key at submit time');
      }
      const req: ExecuteSubmissionRequest = {
        preparedTransaction: body.preparedTransaction,
        partySignatures: shapePartySignatures(key, signed.signatures),
        hashingSchemeVersion: 'HASHING_SCHEME_VERSION_V2',
        submissionId: body.trackingId,
      };
      await port.executeSubmission(req);
      // Canton has no tx hash equivalent until the completion arrives. The
      // returned `updateId` becomes `TxHandle.hash` once `watch` observes
      // the completion; for now hand back the trackingId so the consent UI
      // has something to display.
      return makeHandle('canton-external', signed.prepared.intent, body.trackingId);
    },

    watch(handle: TxHandle): AsyncIterable<TxStatus> {
      return watchViaPort(handle, port, deps.userId);
    },
  };
}

/**
 * Translate a high-level transfer into Daml `Commands`. Hands the port a
 * structured payload it can shape into the real Splice `Commands` proto;
 * the kernel itself never sees the proto bytes. Two shapes by route:
 *   - viaPreapproval: `TransferPreapproval_Send` (one-step).
 *   - two-step: `AmuletRules_TransferOffer_Create` (recipient must accept).
 */
function shapeAmuletTransfer(args: {
  readonly from: string;
  readonly to: string;
  readonly amount: bigint;
  readonly assetSymbol: string;
  readonly memo: string | undefined;
  readonly viaPreapproval: boolean;
  readonly preapprovalContractId?: string;
}): ReadonlyArray<unknown> {
  if (args.viaPreapproval) {
    return [
      {
        _intent: 'amulet-transfer-preapproval',
        sender: args.from,
        receiver: args.to,
        amount: args.amount,
        assetSymbol: args.assetSymbol,
        ...(args.memo !== undefined ? { description: args.memo } : {}),
        preapprovalContractId: args.preapprovalContractId,
      },
    ];
  }
  return [
    {
      _intent: 'amulet-transfer-offer',
      sender: args.from,
      receiver: args.to,
      amount: args.amount,
      assetSymbol: args.assetSymbol,
      ...(args.memo !== undefined ? { description: args.memo } : {}),
    },
  ];
}

/**
 * Shape the SigningDriver's signature output as `partySignatures` for the
 * Interactive Submission Service. Single-party, threshold = N: the
 * SigningDriver returns N signatures (one per signing key) and we attach
 * each to the corresponding `signingKeys[i]`. M-of-N over different parties
 * is a separate flow (multi-party signing) handled outside this surface.
 */
function shapePartySignatures(
  key: CantonPartyKey,
  signatures: ReadonlyArray<Uint8Array>,
): ExecuteSubmissionRequest['partySignatures'] {
  if (signatures.length < key.threshold) {
    throw new Error(`canton-external: need ${key.threshold} signatures, got ${signatures.length}`);
  }
  return signatures.slice(0, key.threshold).map((sig, i) => {
    const sk = key.signingKeys[i];
    if (!sk) throw new Error(`canton-external: missing signing key at index ${i}`);
    return {
      party: key.partyId,
      signature: sig,
      scheme: sk.scheme,
      // Canton's `Fingerprint` (`1220` + lowercase-hex SHA-256 of the public
      // key) is the validator's lookup key into `PartyToKeyMapping`.
      // Precomputed at provision time so the signing path stays sync.
      signedBy: sk.fingerprint,
    };
  });
}

function assertHashingScheme(r: PrepareSubmissionResponse): void {
  if (r.hashingSchemeVersion !== 'HASHING_SCHEME_VERSION_V2') {
    throw new Error(
      `canton-external: unsupported hashing scheme ${r.hashingSchemeVersion}; ` +
        `kernel only knows V2 (see DESIGN.md §11 open question #4)`,
    );
  }
}

/**
 * Watch a Canton submission to completion. Tails `port.tailCompletions`
 * filtered to the user's party + this command id, surfaces the single
 * `executed | failed` finality event as a TxStatus stream.
 */
async function* watchViaPort(
  handle: TxHandle,
  port: CantonValidatorPort,
  userId: string,
): AsyncIterable<TxStatus> {
  yield { handle, phase: 'created' };
  yield { handle, phase: 'pending' };
  // Watching against the port: Canton has no confirmation depth, so we
  // surface a single `confirmed` event for `executed` and stop there.
  for await (const c of port.tailCompletions({
    userId,
    actAs: [handle.surface],
  })) {
    if (c.commandId !== handle.hash) continue; // hash carries the trackingId
    yield {
      handle: { ...handle, hash: c.updateId },
      phase: c.status === 'executed' ? 'confirmed' : 'failed',
      ...(c.errorMessage !== undefined ? { reason: c.errorMessage } : {}),
    };
    return;
  }
}
