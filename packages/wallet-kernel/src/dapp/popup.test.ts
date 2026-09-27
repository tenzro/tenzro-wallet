import { describe, expect, it } from 'vitest';

import {
  POPUP_ERRORS,
  POPUP_PROTOCOL,
  type PopupHost,
  type PopupRequest,
  canUsePasskeysDirectly,
  createPopupProvider,
} from './popup.ts';

const WALLET = 'https://wallet.tenzro.com';

type Listener = (e: { data: unknown; origin: string; source: unknown }) => void;

function fakeHost(opts: { blocked?: boolean } = {}) {
  const listeners = new Set<Listener>();
  const intervals: Array<() => void> = [];
  const sent: PopupRequest[] = [];
  const popup = {
    closed: false,
    postMessage(message: unknown, targetOrigin: string) {
      expect(targetOrigin).toBe(WALLET);
      sent.push(message as PopupRequest);
    },
    close() {
      this.closed = true;
    },
  };
  const host: PopupHost = {
    open: () => (opts.blocked ? null : popup),
    addEventListener: (_t, l) => listeners.add(l),
    removeEventListener: (_t, l) => listeners.delete(l),
    setInterval: (fn) => intervals.push(fn),
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  const emit = (data: unknown, origin = WALLET, source: unknown = popup) => {
    for (const l of [...listeners]) l({ data, origin, source });
  };
  const tick = () => {
    for (const fn of intervals) fn();
  };
  return { host, popup, sent, emit, tick, listeners };
}

describe('popup provider', () => {
  it('sends the request once the wallet is ready and resolves with its answer', async () => {
    const f = fakeHost();
    const p = createPopupProvider({ host: f.host }).request({ method: 'tenzro_connect' });
    f.emit({ protocol: POPUP_PROTOCOL, type: 'ready' });
    expect(f.sent).toHaveLength(1);
    const req = f.sent[0] as PopupRequest;
    expect(req.method).toBe('tenzro_connect');
    f.emit({
      protocol: POPUP_PROTOCOL,
      type: 'response',
      id: req.id,
      result: { account: '0xabc', did: 'did:x' },
    });
    await expect(p).resolves.toEqual({ account: '0xabc', did: 'did:x' });
    expect(f.popup.closed).toBe(true);
    expect(f.listeners.size).toBe(0);
  });

  it('ignores messages from any other origin or window', async () => {
    const f = fakeHost();
    const p = createPopupProvider({ host: f.host }).request({ method: 'tenzro_connect' });
    f.emit({ protocol: POPUP_PROTOCOL, type: 'ready' }, 'https://evil.example');
    f.emit({ protocol: POPUP_PROTOCOL, type: 'ready' }, WALLET, {});
    expect(f.sent).toHaveLength(0);
    f.emit({ protocol: POPUP_PROTOCOL, type: 'ready' });
    const id = (f.sent[0] as PopupRequest).id;
    f.emit(
      { protocol: POPUP_PROTOCOL, type: 'response', id, result: 'forged' },
      'https://evil.example',
    );
    f.emit({ protocol: POPUP_PROTOCOL, type: 'response', id, result: 'real' });
    await expect(p).resolves.toBe('real');
  });

  it('rejects when the person closes the window or declines', async () => {
    const f = fakeHost();
    const closed = createPopupProvider({ host: f.host }).request({ method: 'tenzro_connect' });
    f.popup.closed = true;
    f.tick();
    await expect(closed).rejects.toMatchObject({ code: POPUP_ERRORS.rejected });

    const g = fakeHost();
    const declined = createPopupProvider({ host: g.host }).request({ method: 'tenzro_connect' });
    g.emit({ protocol: POPUP_PROTOCOL, type: 'ready' });
    const id = (g.sent[0] as PopupRequest).id;
    g.emit({
      protocol: POPUP_PROTOCOL,
      type: 'response',
      id,
      error: { code: 4001, message: 'User rejected' },
    });
    await expect(declined).rejects.toMatchObject({ code: 4001, message: 'User rejected' });
  });

  it('refuses unsupported methods and reports a blocked window', async () => {
    await expect(
      createPopupProvider({ host: fakeHost().host }).request({ method: 'eth_sign' }),
    ).rejects.toMatchObject({
      code: POPUP_ERRORS.unsupported,
    });
    await expect(
      createPopupProvider({ host: fakeHost({ blocked: true }).host }).request({
        method: 'tenzro_connect',
      }),
    ).rejects.toMatchObject({ code: POPUP_ERRORS.internal });
  });
});

describe('popup requests with params', () => {
  it('carries a connect challenge and an add-wallet salt to the wallet unchanged', async () => {
    const f = fakeHost();
    const connect = createPopupProvider({ host: f.host }).request({
      method: 'tenzro_connect',
      params: { challenge: 'ab'.repeat(32) },
    });
    f.emit({ protocol: POPUP_PROTOCOL, type: 'ready' });
    const c = f.sent[0] as PopupRequest;
    expect(c.params).toEqual({ challenge: 'ab'.repeat(32) });
    f.emit({
      protocol: POPUP_PROTOCOL,
      type: 'response',
      id: c.id,
      result: { account: '0xa', did: 'd' },
    });
    await connect;

    const g = fakeHost();
    const add = createPopupProvider({ host: g.host }).request({
      method: 'tenzro_addWallet',
      params: { salt: 2 },
    });
    g.emit({ protocol: POPUP_PROTOCOL, type: 'ready' });
    const r = g.sent[0] as PopupRequest;
    expect(r.method).toBe('tenzro_addWallet');
    expect(r.params).toEqual({ salt: 2 });
    g.emit({
      protocol: POPUP_PROTOCOL,
      type: 'response',
      id: r.id,
      result: { account: '0xb', did: 'd', salt: 2 },
    });
    await expect(add).resolves.toEqual({ account: '0xb', did: 'd', salt: 2 });
  });
});

describe('canUsePasskeysDirectly', () => {
  it('allows the RP ID and its subdomains only', () => {
    expect(canUsePasskeysDirectly('tenzro.com', 'tenzro.com')).toBe(true);
    expect(canUsePasskeysDirectly('tenzro.com', 'wallet.tenzro.com')).toBe(true);
    expect(canUsePasskeysDirectly('tenzro.com', 'eviltenzro.com')).toBe(false);
    expect(canUsePasskeysDirectly('tenzro.com', 'app.example.org')).toBe(false);
  });
});
