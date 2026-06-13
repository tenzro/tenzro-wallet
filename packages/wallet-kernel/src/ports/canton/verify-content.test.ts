/**
 * Tests for content-level PreparedTransaction verification. The proto decode
 * itself lives in `@canton-network/core-tx-visualizer` (covered by that
 * package); these tests pin the comparison logic the kernel owns — actAs
 * authorisation, amount equality (incl. the Numeric→base-units normalisation),
 * recipient presence, and fail-closed behaviour on undecodable fields.
 *
 * We mock the visualizer so each test drives a specific decoded shape; the real
 * bytes are irrelevant to the comparison logic under test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseMock = vi.fn();
const validateMock = vi.fn();

vi.mock('@canton-network/core-tx-visualizer', () => ({
  parsePreparedTransaction: (...args: unknown[]) => parseMock(...args),
  validateAuthorizedPartyIds: (...args: unknown[]) => validateMock(...args),
}));

const { verifyPreparedContent, CantonContentMismatchError } = await import('./verify-content.ts');

const FROM = 'alice::1220abcd';
const TO = 'bob::1220ef01';
const PROTO = new Uint8Array([1, 2, 3, 4]);

function intent(over: Partial<Parameters<typeof verifyPreparedContent>[1]> = {}) {
  return { fromParty: FROM, toParty: TO, amount: 100n, assetSymbol: 'CC', ...over };
}

beforeEach(() => {
  parseMock.mockReset();
  validateMock.mockReset();
  // Default happy path: actAs authorised, amount matches, recipient in JSON.
  validateMock.mockReturnValue({ [FROM]: { isAuthorized: true, locations: ['/'] } });
  parseMock.mockReturnValue({
    isCreate: false,
    isExercise: true,
    amount: '100.0000000000',
    jsonString: JSON.stringify({ receiver: TO }),
  });
});

describe('verifyPreparedContent — happy path', () => {
  it('passes when actAs authorised, amount matches, recipient present', () => {
    expect(() => verifyPreparedContent(PROTO, intent())).not.toThrow();
    // Both checks consult the visualizer with a base64 string, not raw bytes.
    expect(typeof validateMock.mock.calls[0]?.[0]).toBe('string');
    expect(validateMock.mock.calls[0]?.[1]).toEqual([FROM]);
  });

  it('accepts recipient surfaced as a signatory', () => {
    parseMock.mockReturnValue({
      isExercise: true,
      amount: '100.0',
      signatories: [FROM, TO],
    });
    expect(() => verifyPreparedContent(PROTO, intent())).not.toThrow();
  });

  it('accepts recipient surfaced as a stakeholder', () => {
    parseMock.mockReturnValue({
      isExercise: true,
      amount: '100',
      stakeholders: [TO],
    });
    expect(() => verifyPreparedContent(PROTO, intent())).not.toThrow();
  });
});

describe('verifyPreparedContent — actAs', () => {
  it('rejects when acting party is not authorised', () => {
    validateMock.mockReturnValue({ [FROM]: { isAuthorized: false, locations: [] } });
    expect(() => verifyPreparedContent(PROTO, intent())).toThrow(CantonContentMismatchError);
    expect(() => verifyPreparedContent(PROTO, intent())).toThrow(/actAs/);
  });

  it('rejects when acting party is absent from the auth result', () => {
    validateMock.mockReturnValue({});
    expect(() => verifyPreparedContent(PROTO, intent())).toThrow(/not present/);
  });
});

describe('verifyPreparedContent — amount', () => {
  it('rejects a mismatched amount', () => {
    parseMock.mockReturnValue({ isExercise: true, amount: '250.0', jsonString: TO });
    expect(() => verifyPreparedContent(PROTO, intent({ amount: 100n }))).toThrow(/amount/);
  });

  it('fails closed when amount is undecodable', () => {
    parseMock.mockReturnValue({ isExercise: true, jsonString: TO }); // no amount
    expect(() => verifyPreparedContent(PROTO, intent())).toThrow(/amount/);
  });

  it('rejects a non-zero fractional amount against a whole-token intent', () => {
    parseMock.mockReturnValue({ isExercise: true, amount: '100.5', jsonString: TO });
    expect(() => verifyPreparedContent(PROTO, intent({ amount: 100n }))).toThrow(/amount/);
  });

  it('treats trailing-zero fractions as equal to the whole-token amount', () => {
    parseMock.mockReturnValue({
      isExercise: true,
      amount: '42.0000000000',
      jsonString: TO,
    });
    expect(() => verifyPreparedContent(PROTO, intent({ amount: 42n }))).not.toThrow();
  });
});

describe('verifyPreparedContent — recipient', () => {
  it('rejects when the recipient is nowhere in the decoded tx', () => {
    parseMock.mockReturnValue({
      isExercise: true,
      amount: '100.0',
      signatories: [FROM],
      jsonString: JSON.stringify({ receiver: 'mallory::1220dead' }),
    });
    expect(() => verifyPreparedContent(PROTO, intent())).toThrow(/toParty/);
  });
});
