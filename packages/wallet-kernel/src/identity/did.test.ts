import { describe, expect, it } from 'vitest';
import type { TdipDid } from '../types/identity.ts';
import { formatTdipDid, parseTdipDid } from './did.ts';

describe('TDIP DID parsing', () => {
  it('parses a human DID', () => {
    const parts = parseTdipDid('did:tenzro:human:abc-123');
    expect(parts.kind).toBe('human');
    expect(parts.uuid).toBe('abc-123');
  });

  it('parses an autonomous machine DID', () => {
    const parts = parseTdipDid('did:tenzro:machine:xyz-9');
    expect(parts.kind).toBe('autonomous-machine');
    expect(parts.uuid).toBe('xyz-9');
  });

  it('parses a controlled-machine DID', () => {
    const parts = parseTdipDid('did:tenzro:machine:owner-uuid:agent-uuid');
    expect(parts.kind).toBe('controlled-machine');
    expect(parts.uuid).toBe('agent-uuid');
    expect(parts.controller).toBe('did:tenzro:human:owner-uuid');
  });

  it('rejects malformed DIDs', () => {
    expect(() => parseTdipDid('did:eth:foo')).toThrow();
    expect(() => parseTdipDid('did:tenzro:weird:foo')).toThrow();
  });

  it('round-trips human DIDs', () => {
    const did = 'did:tenzro:human:abc' as TdipDid;
    const parts = parseTdipDid(did);
    expect(formatTdipDid({ kind: parts.kind, uuid: parts.uuid })).toBe(did);
  });

  it('round-trips controlled-machine DIDs', () => {
    const did = 'did:tenzro:machine:owner:agent' as TdipDid;
    const parts = parseTdipDid(did);
    expect(
      formatTdipDid({
        kind: parts.kind,
        ...(parts.controller !== undefined ? { controller: parts.controller } : {}),
        uuid: parts.uuid,
      }),
    ).toBe(did);
  });
});
