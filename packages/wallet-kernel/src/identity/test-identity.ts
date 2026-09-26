/**
 * Deterministic TDIP identity fixture for unit tests.
 *
 * Real identities come from `PasskeyCustody.createWallet()` (human DID derived
 * from the passkey, smart account guarded by the WebAuthn validator). This
 * fixture fills every surface with placeholder keys so surface and kernel
 * tests can run without a passkey or a node. It is not exported from the
 * package entry point.
 */

import { cantonFingerprint } from '../ports/canton/fingerprint.ts';
import type { CantonKeyScheme, SurfaceKey, TdipIdentity, TdipKind } from '../types/identity.ts';
import { formatTdipDid } from './did.ts';

export interface TestIdentityOptions {
  readonly kind?: TdipKind;
  /** For deterministic test fixtures. */
  readonly uuid?: string;
}

export async function testIdentity(opts: TestIdentityOptions = {}): Promise<TdipIdentity> {
  const kind = opts.kind ?? 'human';
  const uuid = opts.uuid ?? newUuid();
  const did = formatTdipDid({ kind, uuid });

  // Each surface gets a deterministic placeholder key derived from the DID.
  const seed = new TextEncoder().encode(did);
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
        scheme: 'webauthn-p256+ml-dsa-65',
        address: deriveEvmAddress(derive(seed, 'account', 32)),
        credentialIds: [`0x${hex(derive(seed, 'credential', 16))}`],
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

function newUuid(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('testIdentity: crypto.randomUUID unavailable on this runtime');
  }
  return globalThis.crypto.randomUUID();
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function derive(seed: Uint8Array, label: string, len: number): Uint8Array {
  const labelBytes = new TextEncoder().encode(label);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] =
      ((seed[i % seed.length] ?? 0) ^ (labelBytes[i % labelBytes.length] ?? 0) ^ (i * 31)) & 0xff;
  }
  return out;
}

function deriveEvmAddress(seed: Uint8Array): `0x${string}` {
  return `0x${hex(derive(seed, 'evm', 20))}`;
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
 * Placeholders: namespace + signing keys are deterministic 32-byte
 * derivations from the DID seed, threshold = 1, single signing key.
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
 * Base58 encoding (Bitcoin alphabet), used for the SVM placeholder address.
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
