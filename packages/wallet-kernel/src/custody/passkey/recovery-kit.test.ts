import { describe, expect, it } from 'vitest';

import { buildRecoveryKit } from './recovery-kit.ts';

describe('recovery kit', () => {
  it('builds a Recovery Kit with no key material', () => {
    const kit = buildRecoveryKit({
      account: `0x${'11'.repeat(32)}`,
      did: 'did:tenzro:human:kit',
      rpId: 'tenzro.com',
      network: 'Tenzro Network 1',
      record: { version: 0 },
    });
    expect(kit.format).toBe('tenzro-recovery-kit');
    expect(JSON.stringify(kit)).not.toMatch(/secret|seed|cipher/i);
  });
});
