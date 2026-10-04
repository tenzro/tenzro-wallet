import { describe, expect, it } from 'vitest';
import { fromHex, toHex } from './bytes.ts';
import {
  encodeExecuteCall,
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

describe('encodeExecuteCall', () => {
  it('encodes execute(address,uint256,bytes)', () => {
    const data = encodeExecuteCall('0x' + '11'.repeat(20), 7n, new Uint8Array([0xde, 0xad]));
    expect(toHex(data.slice(0, 4))).toBe('b61d27f6');
    expect(toHex(data.slice(16, 36))).toBe('11'.repeat(20));
    expect(BigInt(toHex(data.slice(36, 68), true))).toBe(7n);
    expect(BigInt(toHex(data.slice(68, 100), true))).toBe(0x60n);
    expect(BigInt(toHex(data.slice(100, 132), true))).toBe(2n);
    expect(toHex(data.slice(132, 134))).toBe('dead');
    expect(data.length).toBe(164);
  });

  it('rejects a non-20-byte target', () => {
    expect(() => encodeExecuteCall('0x' + '11'.repeat(32), 1n)).toThrow();
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
