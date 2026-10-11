import { recoveryCodeClaim, recoveryCodeCommitment } from 'tenzro-sdk';
import { describe, expect, it } from 'vitest';

import {
  TURN_OFF_RECOVERY_CODE,
  claimOp,
  codeKit,
  matchesCommitment,
  newRecoveryCode,
  readKit,
  revealOp,
} from './recovery-code';

const ACCOUNT = `0x${'ab'.repeat(20)}`;
const CREDENTIAL = {
  rp_id: 'wallet.example',
  credential_id: '01'.repeat(16),
  public_key: '02'.repeat(64),
  aaguid: '00'.repeat(16),
  backup_eligible: true,
  backup_state: true,
  counts_as_root_from_ms: 0,
  label: 'New phone',
};

describe('recovery code', () => {
  it('puts only the SDK commitment on the account', async () => {
    const { code, op } = await newRecoveryCode(ACCOUNT);
    expect(code).toMatch(/^[0-9a-f]{64}$/);
    expect(op).toEqual({
      set_recovery_code: { commitment: await recoveryCodeCommitment(ACCOUNT, code) },
    });
    expect(JSON.stringify(op)).not.toContain(code);
    expect(TURN_OFF_RECOVERY_CODE).toEqual({ set_recovery_code: { commitment: null } });
  });

  it('a fresh code each time', async () => {
    const a = await newRecoveryCode(ACCOUNT);
    const b = await newRecoveryCode(ACCOUNT);
    expect(a.code).not.toBe(b.code);
  });

  it('the kit carries the account and the code, and says it is not a key', async () => {
    const { code } = await newRecoveryCode(ACCOUNT);
    const kit = codeKit({
      walletName: 'Example Wallet',
      origin: 'https://wallet.example',
      account: ACCOUNT,
      code,
      created: new Date('2026-10-11T00:00:00Z'),
    });
    expect(kit).toContain(ACCOUNT);
    expect(kit).toContain(code);
    expect(kit).toContain('It is not a key');
    expect(kit).toContain('https://wallet.example/recover');
    expect(readKit(kit)).toEqual({ account: ACCOUNT, code });
    expect(readKit(code.toUpperCase()).code).toBe(code);
    expect(() => readKit('nothing here')).toThrow();
  });

  it('checks a typed code against the commitment before anything is sent', async () => {
    const { code, op } = await newRecoveryCode(ACCOUNT);
    const commitment = (op as { set_recovery_code: { commitment: string } }).set_recovery_code
      .commitment;
    expect(await matchesCommitment(ACCOUNT, code, commitment)).toBe(true);
    expect(await matchesCommitment(ACCOUNT, 'ff'.repeat(32), commitment)).toBe(false);
  });

  it('claims first, binding the code to the new passkey, then reveals it', async () => {
    const { code } = await newRecoveryCode(ACCOUNT);
    const claim = await claimOp(ACCOUNT, code, CREDENTIAL);
    expect(claim).toEqual({
      claim_recovery_code: { claim: await recoveryCodeClaim(ACCOUNT, code, CREDENTIAL) },
    });
    expect(JSON.stringify(claim)).not.toContain(code);
    expect(revealOp(code, CREDENTIAL)).toEqual({
      recover_with_code: { code, credential: CREDENTIAL },
    });
  });
});
