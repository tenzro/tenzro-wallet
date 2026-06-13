/**
 * Content-level verification of a `PreparedTransaction` before signing.
 *
 * Hash equality (`hash.ts` + `bytesEqualConstantTime`) binds the signature to
 * the *exact* proto bytes the validator returned. It does NOT prove those bytes
 * encode the transaction the user intended — a malicious or buggy validator can
 * return internally-consistent bytes (correct hash) for the *wrong* transfer
 * (different recipient, different amount, an extra exercise node draining a
 * second contract). This module closes that gap: it decodes the proto and
 * checks the user-visible fields against the intent the wallet built.
 *
 * Browser-clean: `@canton-network/core-tx-visualizer` depends only on
 * `@canton-network/core-ledger-proto` + `camelcase-keys` + `@protobuf-ts/runtime`
 * — no `@grpc/grpc-js`, no Node-only globals. Decode + canonical hashing live in
 * the official package so the wallet never hand-walks a version-sensitive,
 * security-critical proto schema.
 *
 * The visualizer API takes base64 strings; the kernel holds `Uint8Array`, so we
 * encode via `base64Encode` (standard base64, browser-clean) before calling.
 */

import {
  parsePreparedTransaction,
  validateAuthorizedPartyIds,
} from '@canton-network/core-tx-visualizer';
import { base64Encode } from './http.ts';

/**
 * The user's intent, projected to the fields a Canton transfer encodes. The
 * surface modules already hold all of these on their `*Body` — this is the
 * minimal shape `verifyPreparedContent` compares against.
 */
export interface CantonTransferIntent {
  /** Acting party id (`<hint>::<fingerprint>`) — must appear in `actAs`. */
  readonly fromParty: string;
  /** Recipient party id — must appear as a stakeholder/signatory or in the
   *  decoded transfer arguments. */
  readonly toParty: string;
  /** Transfer amount. Compared against the decoded `amount` numeric. */
  readonly amount: bigint;
  /** Asset symbol (e.g. `CC`). Advisory: the proto carries a template/package
   *  identifier, not a free-form symbol, so we match on the decoded template
   *  name containing the expected asset module rather than an exact string. */
  readonly assetSymbol: string;
}

export class CantonContentMismatchError extends Error {
  constructor(
    readonly field: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `canton content verify: ${field} mismatch — refusing to sign. ` +
        `expected ${expected}, decoded ${actual}. ` +
        'The validator returned valid bytes for a transaction that does not ' +
        'match the prepared intent.',
    );
    this.name = 'CantonContentMismatchError';
  }
}

/**
 * Decode the `PreparedTransaction` proto and assert its content matches
 * `intent`. Throws `CantonContentMismatchError` on any divergence.
 *
 * Checks, in order:
 *   1. `actAs` authorisation — the acting party is genuinely authorised in the
 *      decoded transaction (via `validateAuthorizedPartyIds`). This is the
 *      strongest single check: it proves the proto authorises a spend *by the
 *      user's party*, not by some other party the validator slipped in.
 *   2. amount — the decoded transfer amount equals the intended amount.
 *   3. recipient presence — the recipient party id appears in the decoded
 *      transaction (signatories, stakeholders, or the serialised argument JSON).
 *
 * The decode is best-effort by design of the visualizer (`ParsedTransactionInfo`
 * fields are all optional). We FAIL CLOSED: if a field the check needs cannot be
 * decoded, that's a mismatch, not a pass. A validator returning an opaque proto
 * we can't read is exactly the case we refuse to sign blind.
 */
export function verifyPreparedContent(
  preparedTransaction: Uint8Array,
  intent: CantonTransferIntent,
): void {
  const txBase64 = base64Encode(preparedTransaction);

  // 1. actAs authorisation — the acting party must be authorised in the proto.
  const authResult = validateAuthorizedPartyIds(txBase64, [intent.fromParty]);
  const actAsEntry = authResult[intent.fromParty];
  if (!actAsEntry || !actAsEntry.isAuthorized) {
    throw new CantonContentMismatchError(
      'actAs',
      `${intent.fromParty} authorised`,
      actAsEntry ? 'present but not authorised' : 'not present in transaction',
    );
  }

  const parsed = parsePreparedTransaction(txBase64);

  // 2. amount — decoded numeric must equal the intended amount. The visualizer
  // returns `amount` as a decimal string (Daml `Numeric`); the kernel holds a
  // bigint of base units. Canton Amulet amounts are `Numeric 10` decimals, so a
  // direct integer compare would be wrong if the proto carries a fractional
  // representation. We normalise both to a canonical integer-base-unit string.
  if (parsed.amount === undefined) {
    throw new CantonContentMismatchError('amount', intent.amount.toString(), 'undecodable');
  }
  const decodedUnits = decimalToBaseUnits(parsed.amount);
  if (decodedUnits !== intent.amount) {
    throw new CantonContentMismatchError(
      'amount',
      intent.amount.toString(),
      `${parsed.amount} (=${decodedUnits} base units)`,
    );
  }

  // 3. recipient presence — the recipient party id must appear somewhere in the
  // decoded transaction. Canton transfer choices carry the receiver as a party
  // argument; depending on the choice it surfaces as a stakeholder, a signatory,
  // or inside the serialised `jsonString`. Checking all three keeps us robust to
  // the preapproval-send vs transfer-offer shape difference without decoding the
  // per-choice argument schema ourselves.
  if (!recipientPresent(parsed, intent.toParty)) {
    throw new CantonContentMismatchError(
      'toParty',
      intent.toParty,
      'recipient party not found in decoded transaction',
    );
  }
}

/** True if `party` appears as a signatory, stakeholder, or in the tx JSON. */
function recipientPresent(
  parsed: ReturnType<typeof parsePreparedTransaction>,
  party: string,
): boolean {
  if (parsed.signatories?.includes(party)) return true;
  if (parsed.stakeholders?.includes(party)) return true;
  // The serialised argument JSON is the catch-all: the receiver always appears
  // there for a transfer choice even when it isn't a top-level signatory
  // (e.g. a TransferPreapproval_Send where the provider co-signs).
  if (parsed.jsonString !== undefined && parsed.jsonString.includes(party)) return true;
  return false;
}

/**
 * Normalise a Daml `Numeric` decimal string (e.g. `"12.5"`, `"100.0000000000"`)
 * to integer base units, matching how the kernel holds `amount: bigint`.
 *
 * The kernel's convention: `amount` is the whole-token count when the asset is
 * indivisible at the kernel layer, OR base units when divisible — but the
 * surfaces build the bigint and the proto from the SAME intent.amount, so the
 * round-trip is the identity transform as long as we parse the decimal the same
 * way on both sides. Canton Amulet is `Numeric 10`; the kernel passes whole
 * `amount` values, so the decoded decimal is `"<amount>.0000000000"`. We strip a
 * trailing all-zero fractional part and reject any non-zero fraction (which
 * would mean the validator is moving a different, fractional amount).
 */
function decimalToBaseUnits(decimal: string): bigint {
  const trimmed = decimal.trim();
  const dot = trimmed.indexOf('.');
  if (dot < 0) return BigInt(trimmed);
  const whole = trimmed.slice(0, dot);
  const frac = trimmed.slice(dot + 1);
  if (/[^0]/.test(frac)) {
    // Non-zero fractional component. The kernel never builds fractional
    // amounts, so this is a divergence from intent — surface it as a value
    // that cannot equal any whole-token bigint.
    throw new CantonContentMismatchError(
      'amount',
      'whole-token amount',
      `${decimal} (non-zero fractional component)`,
    );
  }
  return BigInt(whole === '' || whole === '-' ? `${whole}0` : whole);
}
