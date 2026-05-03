/**
 * Canton key fingerprint computation.
 *
 * Canton identifies keys (and parties) by a `Fingerprint` string of the
 * form `1220<lowercase-hex-sha256(publicKey)>`. The `1220` prefix is
 * Canton's multihash header (`0x12` = sha2-256, `0x20` = 32 bytes), the
 * same convention as multihash and IPFS CIDs.
 *
 * Used in two places:
 *   1. As the `::xxxx` portion of a `PartyId` (`<hint>::<namespace-fingerprint>`).
 *   2. As `signedBy` on every `partySignature` to `executeSubmission`, so
 *      the validator can look the public key up in `PartyToKeyMapping`
 *      without us carrying the bytes on the wire.
 *
 * Both call sites need the fingerprint to be precomputed at provision time
 * (or at adapter-construction for an externally registered party) so the
 * signing path stays synchronous after the SigningDriver returns.
 */

import { sha256 } from '../../crypto/sha256.ts';

/**
 * Compute the Canton fingerprint string for a public key. Async because
 * SHA-256 is async on WebCrypto; callers cache the result on `CantonPartyKey`.
 */
export async function cantonFingerprint(publicKey: Uint8Array): Promise<string> {
  const hash = await sha256(publicKey);
  let hex = '1220';
  for (const b of hash) hex += b.toString(16).padStart(2, '0');
  return hex;
}
