import { describe, expect, it } from 'vitest';

import { POPUP_PROTOCOL, UNSUPPORTED, readRequest, readTransaction, response } from './popup';
import { duration, remaining } from './waits';

describe('popup protocol', () => {
  it('reads requests and ignores everything else', () => {
    expect(readRequest({ hello: 1 })).toBeNull();
    expect(readRequest({ protocol: POPUP_PROTOCOL, type: 'response', id: '1' })).toBeNull();
    expect(
      readRequest({ protocol: POPUP_PROTOCOL, type: 'request', id: '1', method: 'tenzro_connect' }),
    ).toEqual({ request: { id: '1', method: 'tenzro_connect', params: undefined } });
    expect(
      readRequest({ protocol: POPUP_PROTOCOL, type: 'request', id: '2', method: 'eth_sign' }),
    ).toEqual({ id: '2', error: UNSUPPORTED });
  });

  it('a site cannot pick the sending account', () => {
    expect(() =>
      readTransaction({ kind: 'Transfer', fields: { amount: 1 }, from: `0x${'ab'.repeat(20)}` }),
    ).toThrow(/sending account/);
    expect(readTransaction({ kind: 'Transfer', fields: { amount: 1 }, to: '0x01' })).toEqual({
      kind: 'Transfer',
      fields: { amount: 1 },
      to: '0x01',
    });
    expect(() => readTransaction(null)).toThrow();
  });

  it('answers in the protocol', () => {
    expect(response('9', { result: 1 })).toEqual({
      protocol: POPUP_PROTOCOL,
      type: 'response',
      id: '9',
      result: 1,
    });
  });
});

describe('governed waits', () => {
  it('reads durations as people say them', () => {
    expect(duration(3_600_000)).toBe('1 hour');
    expect(duration(48 * 3_600_000)).toBe('48 hours');
    expect(duration(7 * 86_400_000)).toBe('7 days');
    expect(duration(5 * 60_000)).toBe('5 minutes');
    expect(duration(null)).toBe('a governed wait');
    expect(remaining(1000, 2000)).toBe('now');
    expect(remaining(3_601_000, 1000)).toBe('in 1 hour');
  });
});
