/**
 * Pin the TeeAttestation adapter — snake_case `certificate_chain` → camelCase
 * `certificateChain`, optional `message` is omitted (not undefined-assigned)
 * to satisfy `exactOptionalPropertyTypes`.
 */

import { describe, expect, it } from 'vitest';
import {
  TeeAttestationSdkAdapter,
  type TeeClientLike,
} from './tee-attestation-adapter.ts';

function fakeClient(overrides: Partial<TeeClientLike> = {}): TeeClientLike {
  return {
    detectTee: async () => ({
      available: true,
      vendor: 'intel-tdx',
      capabilities: ['attestation', 'sealing'],
    }),
    getAttestation: async () => ({
      report: '0xreport',
      signature: '0xsig',
      certificate_chain: ['-----BEGIN CERTIFICATE-----\nfoo\n-----END CERTIFICATE-----'],
    }),
    verifyAttestation: async () => ({ valid: true }),
    ...overrides,
  };
}

describe('TeeAttestationSdkAdapter', () => {
  it('detect maps snake_case capabilities array', async () => {
    const adapter = new TeeAttestationSdkAdapter(fakeClient());
    const info = await adapter.detect();
    expect(info.available).toBe(true);
    expect(info.vendor).toBe('intel-tdx');
    expect(info.capabilities).toEqual(['attestation', 'sealing']);
  });

  it('getAttestation maps certificate_chain → certificateChain', async () => {
    const adapter = new TeeAttestationSdkAdapter(fakeClient());
    const r = await adapter.getAttestation('intel-tdx');
    expect(r.report).toBe('0xreport');
    expect(r.signature).toBe('0xsig');
    expect(r.certificateChain).toHaveLength(1);
    expect(r.certificateChain[0]).toContain('BEGIN CERTIFICATE');
  });

  it('verify returns valid:true with no message field when engine omits it', async () => {
    const adapter = new TeeAttestationSdkAdapter(fakeClient());
    const r = await adapter.verify('0xattestation', 'intel-tdx');
    expect(r.valid).toBe(true);
    expect('message' in r).toBe(false);
  });

  it('verify includes message when engine provides one', async () => {
    const adapter = new TeeAttestationSdkAdapter(
      fakeClient({
        verifyAttestation: async () => ({
          valid: false,
          message: 'measurement mismatch',
        }),
      }),
    );
    const r = await adapter.verify('0xattestation', 'intel-tdx');
    expect(r.valid).toBe(false);
    expect(r.message).toBe('measurement mismatch');
  });
});
