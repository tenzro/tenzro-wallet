/**
 * Provision a new TDIP identity. M1: deterministic mock — generates a uuid,
 * derives placeholder per-surface keys. M2 swaps in real key derivation inside
 * the MPC quorum.
 */

import { cantonFingerprint } from '../ports/canton/fingerprint.ts';
import type { CantonKeyScheme, SurfaceKey, TdipIdentity, TdipKind } from '../types/identity.ts';
import { formatTdipDid } from './did.ts';

export interface ProvisionOptions {
  readonly kind?: TdipKind;
  /** For deterministic test fixtures. */
  readonly uuid?: string;
}

export async function provisionIdentity(opts: ProvisionOptions = {}): Promise<TdipIdentity> {
  const kind = opts.kind ?? 'human';
  const uuid = opts.uuid ?? newUuid();
  const did = formatTdipDid({ kind, uuid });

  // M1: each surface gets a deterministic mock key. M2 derives real keys via
  // the MPC quorum (BIP32-like derivation paths inside the threshold scheme).
  const seed = new TextEncoder().encode(did);
  const nativePub = derive(seed, 'native', 32);
  const svmPub = derive(seed, 'svm', 32);
  const cantonInternal = await cantonPartyKey(
    seed,
    'internal',
    'tenzro-internal-synchronizer::1220',
  );
  const cantonExternal = await cantonPartyKey(seed, 'external', 'global-domain::1220');
  const keys = new Map<SurfaceKey['surface'], SurfaceKey>([
    [
      'tenzro-native',
      {
        surface: 'tenzro-native',
        scheme: 'ed25519',
        publicKey: nativePub,
        address: base58Encode(nativePub),
      },
    ],
    [
      'evm-on-tenzro',
      { surface: 'evm-on-tenzro', scheme: 'secp256k1', address: deriveEvmAddress(seed) },
    ],
    [
      'svm-on-tenzro',
      {
        surface: 'svm-on-tenzro',
        scheme: 'ed25519',
        publicKey: svmPub,
        address: base58Encode(svmPub),
      },
    ],
    ['canton-internal', cantonInternal],
    ['canton-external', cantonExternal],
  ]);

  return { did, parts: { method: 'tenzro', kind, uuid }, keys, createdAt: Date.now() };
}

// --- helpers ---

/**
 * Generate an RFC 4122 v4 UUID. Uses `crypto.randomUUID()` (universally
 * available in WebCrypto-capable runtimes — browsers, Node 19+, Workers).
 * M2 will move provisioning into the MPC ceremony where the quorum agrees
 * on the uuid as part of the threshold key generation; this lives here
 * until then.
 */
function newUuid(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('provisionIdentity: crypto.randomUUID unavailable on this runtime');
  }
  return globalThis.crypto.randomUUID();
}

function derive(seed: Uint8Array, label: string, len: number): Uint8Array {
  const labelBytes = new TextEncoder().encode(label);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] =
      ((seed[i % seed.length] ?? 0) ^
        (labelBytes[i % labelBytes.length] ?? 0) ^
        (i * 31)) &
      0xff;
  }
  return out;
}

function deriveEvmAddress(seed: Uint8Array): `0x${string}` {
  const bytes = derive(seed, 'evm', 20);
  let hex = '0x';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex as `0x${string}`;
}

function partyIdFor(hint: string, namespaceFingerprint: string): string {
  // PartyId is `<hint>::<namespace-fingerprint>`. The fingerprint is the
  // multihash-prefixed SHA-256 of the namespace public key, so the party id
  // is bound to the namespace key — rotating signing keys never changes it.
  return `${hint}::${namespaceFingerprint}`;
}

/**
 * Build the canton-internal/canton-external SurfaceKey shape with the new
 * two-key model (per DESIGN.md §4.5.4 and identity.ts:CantonPartyKey).
 *
 * M1 placeholders: namespace + signing keys are deterministic 32-byte
 * derivations from the DID seed, threshold = 1, single signing key. M5+
 * onboarding-flow work replaces this with real Ed25519 keys produced under
 * the passkey-quorum and a M-of-N signing-key set registered via
 * `PartyToKeyMapping`.
 *
 * `synchronizerHostPrefix` is the Canton synchronizer id minus the trailing
 * fingerprint — `global-domain::1220` for external (MainNet),
 * `tenzro-internal-synchronizer::1220` for internal. The full id is
 * completed with a derived 32-byte fingerprint.
 */
async function cantonPartyKey(
  seed: Uint8Array,
  label: 'internal' | 'external',
  synchronizerHostPrefix: string,
): Promise<SurfaceKey> {
  const namespacePub = derive(seed, `canton-${label}-namespace`, 32);
  const signingPub = derive(seed, `canton-${label}-signing`, 32);
  const namespaceFingerprint = await cantonFingerprint(namespacePub);
  const signingFingerprint = await cantonFingerprint(signingPub);
  const synchronizerFp = derive(seed, `canton-${label}-synchronizer-fp`, 32);
  let synchronizerHex = '';
  for (const b of synchronizerFp) synchronizerHex += b.toString(16).padStart(2, '0');
  const signingScheme: CantonKeyScheme = 'ed25519';
  return {
    surface: label === 'internal' ? 'canton-internal' : 'canton-external',
    partyId: partyIdFor(`tenzro-wallet-${label}`, namespaceFingerprint),
    synchronizerId: `${synchronizerHostPrefix}${synchronizerHex.slice(0, 64)}`,
    hostingParticipantId: `tenzro-validator::1220${synchronizerHex.slice(0, 64)}`,
    namespaceKey: {
      scheme: 'ed25519',
      publicKey: namespacePub,
      fingerprint: namespaceFingerprint,
    },
    signingKeys: [
      { scheme: signingScheme, publicKey: signingPub, fingerprint: signingFingerprint },
    ],
    threshold: 1,
  };
}

/**
 * Base58 encoding (Bitcoin alphabet). Tenzro uses Base58 for native and SVM
 * addresses (per `Address` typedef in tenzro-sdk/types.ts). This is a tiny
 * pure-JS implementation; M5 swaps it for the canonical encoder used by
 * the threshold-key derivation routine.
 */
function base58Encode(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  // Convert bytes to a big integer.
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  // Encode.
  let out = '';
  while (n > 0n) {
    const r = Number(n % 58n);
    out = ALPHABET[r] + out;
    n /= 58n;
  }
  // Preserve leading zero-bytes as '1' chars per Base58 convention.
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}
