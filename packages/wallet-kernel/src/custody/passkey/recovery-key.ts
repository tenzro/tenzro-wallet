/**
 * Recovery key and Recovery Kit.
 *
 * The recovery key is a guardian the person holds themselves: an Ed25519 +
 * ML-DSA-65 key pair generated on this device. Only its public halves go on the
 * account (`addGuardian`); the private halves leave the device only as a file
 * encrypted under a passphrase the person chooses (Argon2id, then AES-256-GCM),
 * so the file and the passphrase are two factors. With them, a new passkey can
 * be approved when every device is lost.
 *
 * The Recovery Kit is different: public data only (account, identity, and the
 * signed record of which keys may sign). It holds no key material, so losing or
 * leaking it costs nothing; it lets any node restore who may sign.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

import { concatBytes, fromHex, randomBytes, toHex } from './bytes.ts';

/** Argon2id cost for the passphrase: expensive enough that guessing stays slow. */
export interface RecoveryKdfParams {
  /** Memory in KiB. */
  readonly m: number;
  /** Passes. */
  readonly t: number;
  /** Lanes. */
  readonly p: number;
}

export const DEFAULT_RECOVERY_KDF: RecoveryKdfParams = { m: 65536, t: 3, p: 1 };

const FORMAT = 'tenzro-recovery-key';
const KIT_FORMAT = 'tenzro-recovery-kit';
const ED25519_SIG_LEN = 64;
const ML_DSA_65_SIG_LEN = 3309;

/** A recovery key in memory. `wipe()` zeroes the private halves. */
export interface RecoveryKey {
  readonly ed25519PublicKeyHex: string;
  readonly mlDsaPublicKeyHex: string;
  /** Signs a recovery: Ed25519 (64 bytes) followed by ML-DSA-65 (3309), hex. */
  signRecovery(recoveryOpHashHex: string): string;
  wipe(): void;
}

/** The downloadable, passphrase-encrypted form. Safe to store; useless without the passphrase. */
export interface RecoveryKeyFile {
  readonly format: typeof FORMAT;
  readonly version: 1;
  readonly account: string;
  readonly did: string;
  /** This key's position in the account's guardian list, as the node assigned it. */
  readonly guardianIndex: number;
  readonly createdAt: string;
  readonly public: { readonly ed25519: string; readonly mlDsa65: string };
  readonly kdf: { readonly alg: 'argon2id'; readonly salt: string } & RecoveryKdfParams;
  readonly cipher: {
    readonly alg: 'aes-256-gcm';
    readonly iv: string;
    readonly ciphertext: string;
  };
}

export class RecoveryKeyError extends Error {
  constructor(
    message: string,
    readonly code: 'bad-file' | 'bad-passphrase' | 'weak-passphrase',
  ) {
    super(message);
    this.name = 'RecoveryKeyError';
  }
}

function fromSeeds(edSecret: Uint8Array, mlSeed: Uint8Array): RecoveryKey {
  const edPublic = ed25519.getPublicKey(edSecret);
  const ml = ml_dsa65.keygen(mlSeed);
  return {
    ed25519PublicKeyHex: toHex(edPublic, true),
    mlDsaPublicKeyHex: toHex(ml.publicKey, true),
    signRecovery(recoveryOpHashHex: string): string {
      const hash = fromHex(recoveryOpHashHex);
      if (hash.length !== 32)
        throw new RecoveryKeyError('A recovery hash is 32 bytes.', 'bad-file');
      return toHex(
        concatBytes(ed25519.sign(hash, edSecret), ml_dsa65.sign(hash, ml.secretKey)),
        true,
      );
    },
    wipe(): void {
      edSecret.fill(0);
      mlSeed.fill(0);
      ml.secretKey.fill(0);
    },
  };
}

async function aesKey(
  passphrase: string,
  salt: Uint8Array,
  p: RecoveryKdfParams,
): Promise<CryptoKey> {
  const raw = await argon2idAsync(new TextEncoder().encode(passphrase), salt, {
    m: p.m,
    t: p.t,
    p: p.p,
    dkLen: 32,
  });
  try {
    return await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]);
  } finally {
    raw.fill(0);
  }
}

/** Encrypts a new recovery key under `passphrase` into the file a person saves. */
export async function exportRecoveryKey(
  created: { readonly key: RecoveryKey; readonly secrets: RecoveryKeySecrets },
  opts: {
    readonly account: string;
    readonly did: string;
    readonly guardianIndex: number;
    readonly passphrase: string;
    readonly kdf?: RecoveryKdfParams;
  },
): Promise<RecoveryKeyFile> {
  const key = created.key;
  if (opts.passphrase.length < 12) {
    throw new RecoveryKeyError('Use a passphrase of at least 12 characters.', 'weak-passphrase');
  }
  const kdf = opts.kdf ?? DEFAULT_RECOVERY_KDF;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const plaintext = concatBytes(created.secrets.ed25519Secret, created.secrets.mlDsaSeed);
  try {
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv as BufferSource,
          additionalData: new TextEncoder().encode(opts.account),
        },
        await aesKey(opts.passphrase, salt, kdf),
        plaintext as BufferSource,
      ),
    );
    return {
      format: FORMAT,
      version: 1,
      account: opts.account,
      did: opts.did,
      guardianIndex: opts.guardianIndex,
      createdAt: new Date().toISOString(),
      public: { ed25519: key.ed25519PublicKeyHex, mlDsa65: key.mlDsaPublicKeyHex },
      kdf: { alg: 'argon2id', salt: toHex(salt), ...kdf },
      cipher: { alg: 'aes-256-gcm', iv: toHex(iv), ciphertext: toHex(ciphertext) },
    };
  } finally {
    plaintext.fill(0);
  }
}

/** The private halves of a recovery key, kept only as long as it takes to export them. */
export interface RecoveryKeySecrets {
  readonly ed25519Secret: Uint8Array;
  readonly mlDsaSeed: Uint8Array;
}

/** Generates a recovery key and returns its private halves alongside, for `exportRecoveryKey`. */
export function createRecoveryKey(): {
  readonly key: RecoveryKey;
  readonly secrets: RecoveryKeySecrets;
} {
  const ed25519Secret = randomBytes(32);
  const mlDsaSeed = randomBytes(32);
  const key = fromSeeds(ed25519Secret, mlDsaSeed);
  return { key, secrets: { ed25519Secret, mlDsaSeed } };
}

/** Opens a recovery key file with its passphrase. */
export async function importRecoveryKey(
  file: unknown,
  passphrase: string,
): Promise<
  RecoveryKey & { readonly account: string; readonly did: string; readonly guardianIndex: number }
> {
  const f = file as Partial<RecoveryKeyFile> | null;
  if (
    !f ||
    f.format !== FORMAT ||
    f.version !== 1 ||
    !f.kdf ||
    !f.cipher ||
    !f.public ||
    !f.account ||
    typeof f.guardianIndex !== 'number'
  ) {
    throw new RecoveryKeyError('This is not a Tenzro recovery key file.', 'bad-file');
  }
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: fromHex(f.cipher.iv) as BufferSource,
          additionalData: new TextEncoder().encode(f.account),
        },
        await aesKey(passphrase, fromHex(f.kdf.salt), f.kdf),
        fromHex(f.cipher.ciphertext) as BufferSource,
      ),
    );
  } catch {
    throw new RecoveryKeyError('That passphrase does not open this file.', 'bad-passphrase');
  }
  if (plaintext.length !== 64) throw new RecoveryKeyError('The file is damaged.', 'bad-file');
  const key = fromSeeds(plaintext.slice(0, 32), plaintext.slice(32));
  plaintext.fill(0);
  if (key.ed25519PublicKeyHex !== f.public.ed25519 || key.mlDsaPublicKeyHex !== f.public.mlDsa65) {
    key.wipe();
    throw new RecoveryKeyError('The file is damaged: its keys do not match.', 'bad-file');
  }
  return Object.assign(key, {
    account: f.account,
    did: f.did ?? '',
    guardianIndex: f.guardianIndex,
  });
}

/** Splits a signature produced by `signRecovery` back into its two legs (for checks and tests). */
export function splitRecoverySignature(hex: string): {
  readonly ed25519: Uint8Array;
  readonly mlDsa65: Uint8Array;
} {
  const b = fromHex(hex);
  if (b.length !== ED25519_SIG_LEN + ML_DSA_65_SIG_LEN)
    throw new RecoveryKeyError('Unexpected signature length.', 'bad-file');
  return { ed25519: b.slice(0, ED25519_SIG_LEN), mlDsa65: b.slice(ED25519_SIG_LEN) };
}

/** The Recovery Kit: public data a person saves so any node can restore who may sign. */
export interface RecoveryKit {
  readonly format: typeof KIT_FORMAT;
  readonly version: 1;
  readonly createdAt: string;
  readonly network: string;
  readonly rpId: string;
  readonly account: string;
  readonly did: string;
  /** The signed account record, exactly as the node published it. */
  readonly record: unknown;
}

export function buildRecoveryKit(opts: {
  readonly account: string;
  readonly did: string;
  readonly rpId: string;
  readonly network: string;
  readonly record: unknown;
}): RecoveryKit {
  return {
    format: KIT_FORMAT,
    version: 1,
    createdAt: new Date().toISOString(),
    network: opts.network,
    rpId: opts.rpId,
    account: opts.account,
    did: opts.did,
    record: opts.record,
  };
}
