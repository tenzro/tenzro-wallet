/**
 * Canton participant resolution: the operator's base URLs and its own JWT,
 * as Authorization or X-Canton-Auth.
 */

import { describe, expect, it } from 'vitest';

import { resolveCantonAdapterConfig } from './canton-provider.ts';

describe('resolveCantonAdapterConfig', () => {
  it('uses the operator base URLs + default Authorization: Bearer (no authHeaders)', async () => {
    const cfg = resolveCantonAdapterConfig({
      ledgerBaseUrl: 'https://canton.acme.example:7575',
      validatorBaseUrl: 'https://canton.acme.example:5003',
      userId: 'acme-app',
      token: async () => 'jwt-abc',
    });

    expect(cfg.ledgerBaseUrl).toBe('https://canton.acme.example:7575');
    expect(cfg.validatorBaseUrl).toBe('https://canton.acme.example:5003');
    expect(cfg.userId).toBe('acme-app');
    expect(cfg.authHeaders).toBeUndefined();
    expect(await cfg.token()).toBe('jwt-abc');
  });

  it('uses X-Canton-Auth when useCantonAuthHeader is set (BYO-issuer escape hatch)', async () => {
    const cfg = resolveCantonAdapterConfig({
      ledgerBaseUrl: 'https://canton.acme.example:7575',
      validatorBaseUrl: 'https://canton.acme.example:5003',
      userId: 'acme-app',
      token: async () => 'jwt-xyz',
      useCantonAuthHeader: true,
    });

    const headers = await cfg.authHeaders?.();
    expect(headers).toEqual({ 'x-canton-auth': 'Bearer jwt-xyz' });
    // token still resolvable for any other consumer.
    expect(await cfg.token()).toBe('jwt-xyz');
  });

  it('threads through an injected fetch', () => {
    const f = (() => undefined) as unknown as typeof fetch;
    const cfg = resolveCantonAdapterConfig({
      ledgerBaseUrl: 'https://canton.acme.example:7575',
      validatorBaseUrl: 'https://canton.acme.example:5003',
      userId: 'acme-app',
      token: async () => 'jwt-abc',
      fetch: f,
    });
    expect(cfg.fetch).toBe(f);
  });
});
