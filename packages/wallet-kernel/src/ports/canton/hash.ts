/**
 * Canton hash recomputation. The Interactive Submission Service returns a
 * `preparedTransactionHash` alongside the `preparedTransaction` proto bytes;
 * the wallet recomputes the hash locally and asserts equality before
 * signing. Otherwise the wallet would be trusting the validator on what
 * it's authorising — defeats the entire point of external signing.
 *
 * Canon (per Canton OSS `community/util-internal/src/main/scala/com/digitalasset/canton/crypto/HashPurpose.scala` and
 * `HashAlgorithm.scala`):
 *
 *   hashed = SHA-256( hash_purpose_be_u32 || hash_algorithm_byte || payload )
 *
 *   - **hash_purpose** is a fixed 4-byte big-endian integer identifying what
 *     is being hashed. `PreparedTransaction = 11`.
 *   - **hash_algorithm_byte** identifies the SHA variant. `Sha256 = 0`.
 *   - **payload** is the canonical proto bytes returned in
 *     `preparedTransaction`.
 *
 * Hashing scheme version V2 is what 0.5.16 ships. V3 will change the
 * canonicalisation rules; we reject V3 explicitly until the kernel
 * implements them (see DESIGN.md §11 open question #4).
 */

import { concatBytes, sha256 } from '../../crypto/sha256.ts';

/** `PreparedTransaction` per Canton's `HashPurpose`. */
const HASH_PURPOSE_PREPARED_TRANSACTION = 11;

/** `Sha256` per Canton's `HashAlgorithm`. */
const HASH_ALGORITHM_SHA256 = 0;

/** Canton bundle hash for multi-tx topology submissions (onboarding). */
const HASH_PURPOSE_TOPOLOGY_TRANSACTION_BUNDLE = 55;

/**
 * Recompute the `preparedTransactionHash` from the proto bytes the validator
 * returned. The wallet calls this in `sign()` and asserts equality before
 * handing the hash to the SigningDriver.
 */
export async function preparedTransactionHash(
  preparedTransaction: Uint8Array,
): Promise<Uint8Array> {
  return cantonHash(HASH_PURPOSE_PREPARED_TRANSACTION, preparedTransaction);
}

/**
 * Recompute the topology bundle hash from the three onboarding txs the
 * validator returned. The user signs *this* hash with the namespace key.
 */
export async function topologyBundleHash(
  bundle: ReadonlyArray<Uint8Array>,
): Promise<Uint8Array> {
  // The bundle hash inputs are concatenated in their wire order. Canton
  // doesn't length-prefix them at the hash layer — the proto's outer
  // structure already disambiguates.
  return cantonHash(HASH_PURPOSE_TOPOLOGY_TRANSACTION_BUNDLE, concatBytes(...bundle));
}

async function cantonHash(
  purpose: number,
  payload: Uint8Array,
): Promise<Uint8Array> {
  const purposeBytes = new Uint8Array(4);
  // Big-endian u32.
  purposeBytes[0] = (purpose >>> 24) & 0xff;
  purposeBytes[1] = (purpose >>> 16) & 0xff;
  purposeBytes[2] = (purpose >>> 8) & 0xff;
  purposeBytes[3] = purpose & 0xff;
  const algoByte = new Uint8Array([HASH_ALGORITHM_SHA256]);
  return sha256(concatBytes(purposeBytes, algoByte, payload));
}

/** Constant-time byte equality. Used after recomputing the hash so a
 *  mismatched validator can't leak information via timing. */
export function bytesEqualConstantTime(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i]! ^ b[i]!);
  return diff === 0;
}
