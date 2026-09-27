import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { describe, expect, it } from 'vitest';

import { fromHex } from './bytes.ts';
import {
  RecoveryKeyError,
  buildRecoveryKit,
  createRecoveryKey,
  exportRecoveryKey,
  importRecoveryKey,
  splitRecoverySignature,
} from './recovery-key.ts';

// Cheap parameters for tests; production uses DEFAULT_RECOVERY_KDF.
const kdf = { m: 256, t: 1, p: 1 };
const account = '0x00000000000000000000000000000000000000aa';
const did = 'did:tenzro:human:test';
const hash = `0x${'11'.repeat(32)}`;

describe('recovery key', () => {
  it('round-trips through the encrypted file and signs a recovery both legs verify', async () => {
    const created = createRecoveryKey();
    const file = await exportRecoveryKey(created, {
      account,
      did,
      guardianIndex: 0,
      passphrase: 'correct horse battery',
      kdf,
    });
    expect(JSON.stringify(file)).not.toContain(created.key.signRecovery(hash).slice(2, 40));

    const opened = await importRecoveryKey(file, 'correct horse battery');
    expect(opened.ed25519PublicKeyHex).toBe(created.key.ed25519PublicKeyHex);
    expect(opened.account).toBe(account);
    expect(opened.guardianIndex).toBe(0);

    const { ed25519: edSig, mlDsa65: mlSig } = splitRecoverySignature(opened.signRecovery(hash));
    expect(ed25519.verify(edSig, fromHex(hash), fromHex(opened.ed25519PublicKeyHex))).toBe(true);
    expect(ml_dsa65.verify(mlSig, fromHex(hash), fromHex(opened.mlDsaPublicKeyHex))).toBe(true);
  });

  it('refuses the wrong passphrase', async () => {
    const file = await exportRecoveryKey(createRecoveryKey(), {
      account,
      did,
      guardianIndex: 0,
      passphrase: 'correct horse battery',
      kdf,
    });
    await expect(importRecoveryKey(file, 'wrong horse battery')).rejects.toMatchObject({
      code: 'bad-passphrase',
    });
  });

  it('refuses a file that was moved to another account or tampered with', async () => {
    const file = await exportRecoveryKey(createRecoveryKey(), {
      account,
      did,
      guardianIndex: 0,
      passphrase: 'correct horse battery',
      kdf,
    });
    await expect(
      importRecoveryKey(
        { ...file, account: '0x00000000000000000000000000000000000000bb' },
        'correct horse battery',
      ),
    ).rejects.toBeInstanceOf(RecoveryKeyError);
    const flipped = file.cipher.ciphertext.replace(/^./, (c) => (c === '0' ? '1' : '0'));
    await expect(
      importRecoveryKey(
        { ...file, cipher: { ...file.cipher, ciphertext: flipped } },
        'correct horse battery',
      ),
    ).rejects.toMatchObject({ code: 'bad-passphrase' });
    await expect(importRecoveryKey({ format: 'something-else' }, 'x')).rejects.toMatchObject({
      code: 'bad-file',
    });
  });

  it('refuses a short passphrase', async () => {
    await expect(
      exportRecoveryKey(createRecoveryKey(), {
        account,
        did,
        guardianIndex: 0,
        passphrase: 'short',
        kdf,
      }),
    ).rejects.toMatchObject({
      code: 'weak-passphrase',
    });
  });

  it('wipes private halves on request', () => {
    const { key, secrets } = createRecoveryKey();
    key.wipe();
    expect(secrets.ed25519Secret.every((b) => b === 0)).toBe(true);
    expect(secrets.mlDsaSeed.every((b) => b === 0)).toBe(true);
  });

  it('builds a Recovery Kit with no key material', () => {
    const kit = buildRecoveryKit({
      account,
      did,
      rpId: 'tenzro.com',
      network: 'Tenzro Network 1',
      record: { version: 0 },
    });
    expect(kit.format).toBe('tenzro-recovery-kit');
    expect(JSON.stringify(kit)).not.toMatch(/secret|seed|cipher/i);
  });
});
