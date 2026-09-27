import { describe, expect, it } from 'vitest';
import { fromHex, toHex } from './bytes.ts';
import {
  encodeExecuteBatch,
  encodeExecuteSingle,
  MAX_BATCH_CALLS,
  encodeHybridSignatureBundle,
  userOperationHash,
  userOperationToJson,
} from './userop.ts';

describe('userOperationHash', () => {
  it('matches the EntryPoint v0.8 EIP-712 hash', () => {
    // Reference computed in Rust with the field encoding of
    // crates/tenzro-vm/src/account_abstraction.rs (UserOperation::hash).
    const hash = userOperationHash(
      {
        sender: '0x1234567890abcdef1234567890abcdef12345678',
        nonce: 5n,
        callData: fromHex('b61d27f6'),
        callGasLimit: 100_000n,
        verificationGasLimit: 500_000n,
        preVerificationGas: 50_000n,
        maxFeePerGas: 1_000_000_000n,
        maxPriorityFeePerGas: 2_000_000_000n,
      },
      1337n,
      '0x0000000000000000000000000000000000004337',
    );
    expect(toHex(hash)).toBe('7f2d210634b43b82d7bbdd1a7e1f2eb79ab627b9e4a0a358a63403adffa455c5');
  });
});

describe('encodeHybridSignatureBundle', () => {
  it('matches bincode 1.x encoding of Vec<HybridWebAuthnSignature>', () => {
    const bundle = encodeHybridSignatureBundle([
      {
        authenticatorData: new Uint8Array([1, 2, 3]),
        clientDataJson: new TextEncoder().encode('{}'),
        signature: new Uint8Array(4).fill(9),
        mlDsaSignature: new Uint8Array(5).fill(7),
        credentialId: new Uint8Array([0xaa, 0xbb]),
      },
      {
        authenticatorData: new Uint8Array([4]),
        clientDataJson: new Uint8Array(0),
        signature: new Uint8Array([8]),
        userHandle: new Uint8Array([5, 6]),
        mlDsaSignature: new Uint8Array(0),
        credentialId: new Uint8Array([0xcc]),
      },
    ]);
    // Reference: `bincode::serialize` (bincode 1) of the same structs in Rust.
    expect(toHex(bundle)).toBe(
      '0200000000000000030000000000000001020302000000000000007b7d04000000000000000909090900050000000000000007070707070200000000000000aabb0100000000000000040000000000000000010000000000000008010200000000000000050600000000000000000100000000000000cc',
    );
  });
});

// Expected bytes come from an independent transcription of the network's
// reference encoders (tenzro_vm::encode_single / encode_batch).
describe('ERC-7579 execute', () => {
  const A = '0x' + '11'.repeat(20);
  const B = '0x' + '22'.repeat(20);

  it('encodes one call with no data', () => {
    expect(toHex(encodeExecuteSingle({ to: A, value: 10n ** 18n }))).toBe('e9ae5c5300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000003411111111111111111111111111111111111111110000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000');
  });

  it('encodes one call with data', () => {
    expect(toHex(encodeExecuteSingle({ to: A, value: 5n, data: fromHex('a9059cbb') }))).toBe('e9ae5c5300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000003811111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000000000005a9059cbb0000000000000000');
  });

  it('encodes a batch as abi.encode((address,uint256,bytes)[])', () => {
    expect(
      toHex(encodeExecuteBatch([{ to: A, value: 1n }, { to: B, value: 2n, data: fromHex('deadbeef') }])),
    ).toBe('e9ae5c530100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000004deadbeef00000000000000000000000000000000000000000000000000000000');
  });

  it('refuses what the network would refuse', () => {
    expect(() => encodeExecuteSingle({ to: '0x' + '11'.repeat(32), value: 1n })).toThrow();
    expect(() => encodeExecuteSingle({ to: A, value: 1n << 128n })).toThrow();
    expect(() => encodeExecuteBatch([])).toThrow();
    expect(() => encodeExecuteBatch(Array.from({ length: MAX_BATCH_CALLS + 1 }, () => ({ to: A, value: 0n })))).toThrow();
  });
});

describe('userOperationToJson', () => {
  it('emits hex quantities and omits empty optional fields', () => {
    const json = userOperationToJson({
      sender: '0xabc0000000000000000000000000000000000000',
      nonce: 0n,
      callData: new Uint8Array([1]),
      callGasLimit: 1n,
      verificationGasLimit: 2n,
      preVerificationGas: 3n,
      maxFeePerGas: 4n,
      maxPriorityFeePerGas: 5n,
      signature: new Uint8Array([0xff]),
    });
    expect(json).toEqual({
      sender: '0xabc0000000000000000000000000000000000000',
      nonce: '0x0',
      callData: '0x01',
      callGasLimit: '0x1',
      verificationGasLimit: '0x2',
      preVerificationGas: '0x3',
      maxFeePerGas: '0x4',
      maxPriorityFeePerGas: '0x5',
      signature: '0xff',
    });
  });
});
