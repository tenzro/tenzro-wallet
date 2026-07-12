/**
 * Tests for dual-mode Canton provider resolution. Pin the per-mode auth-header
 * and base-URL derivation: BYO node (Authorization / X-Canton-Auth) vs Tenzro
 * Network (X-Tenzro-Api-Key, single base URL, token() fails closed).
 */

import { describe, expect, it } from 'vitest';

import { resolveCantonAdapterConfig } from './canton-provider.ts';

describe('resolveCantonAdapterConfig — tenzro-network', () => {
  it('points both seams at the single base URL and authenticates with the API key', async () => {
    const cfg = resolveCantonAdapterConfig({
      mode: 'tenzro-network',
      baseUrl: 'https://node.tenzro.xyz',
      userId: 'tenant@clients',
      apiKey: async () => 'tnz_secret',
    });

    expect(cfg.ledgerBaseUrl).toBe('https://node.tenzro.xyz');
    expect(cfg.validatorBaseUrl).toBe('https://node.tenzro.xyz');
    expect(cfg.userId).toBe('tenant@clients');

    const headers = await cfg.authHeaders?.();
    expect(headers).toEqual({ 'x-tenzro-api-key': 'tnz_secret' });
  });

  it('fails closed if token() is ever consulted', async () => {
    const cfg = resolveCantonAdapterConfig({
      mode: 'tenzro-network',
      baseUrl: 'https://node.tenzro.xyz',
      userId: 'tenant@clients',
      apiKey: async () => 'tnz_secret',
    });

    await expect(cfg.token()).rejects.toThrow(/token\(\) must not be called/);
  });

  it('threads through an injected fetch', () => {
    const f = (() => undefined) as unknown as typeof fetch;
    const cfg = resolveCantonAdapterConfig({
      mode: 'tenzro-network',
      baseUrl: 'https://node.tenzro.xyz',
      userId: 'tenant@clients',
      apiKey: async () => 'tnz_secret',
      fetch: f,
    });
    expect(cfg.fetch).toBe(f);
  });
});

describe('resolveCantonAdapterConfig — byo-node', () => {
  it('uses the operator base URLs + default Authorization: Bearer (no authHeaders)', async () => {
    const cfg = resolveCantonAdapterConfig({
      mode: 'byo-node',
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
      mode: 'byo-node',
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
      mode: 'byo-node',
      ledgerBaseUrl: 'https://canton.acme.example:7575',
      validatorBaseUrl: 'https://canton.acme.example:5003',
      userId: 'acme-app',
      token: async () => 'jwt-abc',
      fetch: f,
    });
    expect(cfg.fetch).toBe(f);
  });
});
