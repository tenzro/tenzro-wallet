/**
 * Pin the ShareEnvelopeHttpAdapter wire shape against `/wallet/share/*`.
 * No real network — `fetch` is captured.
 *
 * Focus is the kernel-relied mappings:
 *   - `fetchEnvelope` issues GET with snake_case query params (no body)
 *     and decodes `wrapped_share_b64` / `salt_b64` to `Uint8Array`;
 *   - `startEscrow` POSTs snake_case JSON; reply renames `expires_at`;
 *   - `finishEscrow` POSTs nested assertion with snake_case fields and
 *     decodes both byte fields;
 *   - non-2xx surfaces as `ShareEnvelopeHttpError`;
 *   - trailing slashes on baseUrl are normalised;
 *   - per-request `headers()` callback is awaited and merged.
 */

import { describe, expect, it } from 'vitest';
import {
  ShareEnvelopeHttpAdapter,
  ShareEnvelopeHttpError,
  type ShareEnvelopeHttpConfig,
} from './http-adapter.ts';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function captureFetch(
  respond: (path: string) => Response,
): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const u = url as string;
    calls.push({
      url: u,
      method: (init?.method ?? 'GET') as string,
      headers: (init?.headers as Record<string, string> | undefined) ?? {},
      body: (init?.body as string) ?? '',
    });
    return respond(u);
  };
  return { fetch: fetchImpl, calls };
}

function cfg(
  fetchImpl: typeof fetch,
  extra: Partial<ShareEnvelopeHttpConfig> = {},
): ShareEnvelopeHttpConfig {
  return { baseUrl: 'https://rpc.tenzro.test', fetch: fetchImpl, ...extra };
}

describe('ShareEnvelopeHttpAdapter.fetchEnvelope', () => {
  it('GETs /wallet/share/envelope with snake_case query and decodes bytes', async () => {
    // wrapped_share = [10,20,30] → 'ChQe', salt = [1,2] → 'AQI='
    const { fetch, calls } = captureFetch(() =>
      new Response(
        JSON.stringify({
          wrapped_share_b64: 'ChQe',
          alg: 'aes-256-gcm',
          salt_b64: 'AQI=',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const adapter = new ShareEnvelopeHttpAdapter(cfg(fetch));
    const r = await adapter.fetchEnvelope({
      credentialId: 'cred-1',
      surfaceKeyId: 'tenzro-native#0',
      scheme: 'ed25519',
    });

    expect(Array.from(r.wrappedShare)).toEqual([10, 20, 30]);
    expect(r.alg).toBe('aes-256-gcm');
    expect(Array.from(r.salt)).toEqual([1, 2]);

    const url = calls[0]!.url;
    expect(url.startsWith('https://rpc.tenzro.test/wallet/share/envelope?')).toBe(true);
    const qs = new URL(url).searchParams;
    expect(qs.get('credential_id')).toBe('cred-1');
    expect(qs.get('surface_key')).toBe('tenzro-native#0');
    expect(qs.get('scheme')).toBe('ed25519');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.body).toBe('');
    expect(calls[0]?.headers['content-type']).toBeUndefined();
  });
});

describe('ShareEnvelopeHttpAdapter.startEscrow', () => {
  it('POSTs snake_case body and renames expires_at', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(JSON.stringify({ nonce: 'abc', expires_at: 1700 })),
    );
    const adapter = new ShareEnvelopeHttpAdapter(cfg(fetch));
    const r = await adapter.startEscrow({
      credentialId: 'cred-1',
      surfaceKeyId: 'k',
      scheme: 'secp256k1',
    });
    expect(r.nonce).toBe('abc');
    expect(r.expiresAt).toBe(1700);

    expect(calls[0]?.url).toBe('https://rpc.tenzro.test/wallet/share/escrow/challenge');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(calls[0]!.body)).toEqual({
      credential_id: 'cred-1',
      surface_key: 'k',
      scheme: 'secp256k1',
    });
  });
});

describe('ShareEnvelopeHttpAdapter.finishEscrow', () => {
  it('POSTs snake_case assertion and decodes wrapped_share_b64 + pepper_b64', async () => {
    // wrapped = [99] → 'Yw==', pepper = [7,7] → 'Bwc='
    const { fetch, calls } = captureFetch(() =>
      new Response(
        JSON.stringify({ wrapped_share_b64: 'Yw==', pepper_b64: 'Bwc=' }),
      ),
    );
    const adapter = new ShareEnvelopeHttpAdapter(cfg(fetch));
    const r = await adapter.finishEscrow({
      credentialId: 'cred-1',
      surfaceKeyId: 'k',
      scheme: 'ed25519',
      nonce: 'abc',
      assertion: {
        credentialId: 'cred-1',
        clientDataJson: 'cdj',
        authenticatorData: 'ad',
        signature: 'sig',
      },
    });

    expect(Array.from(r.wrappedShare)).toEqual([99]);
    expect(Array.from(r.pepper)).toEqual([7, 7]);

    expect(calls[0]?.url).toBe('https://rpc.tenzro.test/wallet/share/escrow/unwrap');
    expect(JSON.parse(calls[0]!.body)).toEqual({
      credential_id: 'cred-1',
      surface_key: 'k',
      scheme: 'ed25519',
      nonce: 'abc',
      assertion: {
        credential_id: 'cred-1',
        client_data_json: 'cdj',
        authenticator_data: 'ad',
        signature: 'sig',
      },
    });
  });
});

describe('ShareEnvelopeHttpAdapter — config knobs', () => {
  it('normalises trailing slash on baseUrl', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(JSON.stringify({ nonce: 'n', expires_at: 1 })),
    );
    const adapter = new ShareEnvelopeHttpAdapter(
      cfg(fetch, { baseUrl: 'https://rpc.tenzro.test///' }),
    );
    await adapter.startEscrow({
      credentialId: 'c', surfaceKeyId: 'k', scheme: 'ed25519',
    });
    expect(calls[0]?.url).toBe(
      'https://rpc.tenzro.test/wallet/share/escrow/challenge',
    );
  });

  it('awaits headers() and merges into POST request', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(JSON.stringify({ nonce: 'n', expires_at: 1 })),
    );
    const adapter = new ShareEnvelopeHttpAdapter(
      cfg(fetch, {
        headers: async () => ({ 'X-Trace': 'abc' }),
      }),
    );
    await adapter.startEscrow({
      credentialId: 'c', surfaceKeyId: 'k', scheme: 'ed25519',
    });
    expect(calls[0]?.headers).toEqual({
      'content-type': 'application/json',
      'X-Trace': 'abc',
    });
  });

  it('sends headers on GET without content-type', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(
        JSON.stringify({
          wrapped_share_b64: '', alg: 'aes-256-gcm', salt_b64: '',
        }),
      ),
    );
    const adapter = new ShareEnvelopeHttpAdapter(
      cfg(fetch, { headers: () => ({ 'X-Trace': 'abc' }) }),
    );
    await adapter.fetchEnvelope({
      credentialId: 'c', surfaceKeyId: 'k', scheme: 'ed25519',
    });
    expect(calls[0]?.headers).toEqual({ 'X-Trace': 'abc' });
  });
});

describe('ShareEnvelopeHttpAdapter error handling', () => {
  it('throws ShareEnvelopeHttpError on non-2xx', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('rate limited', { status: 429 });
    const adapter = new ShareEnvelopeHttpAdapter(cfg(fetchImpl));
    await expect(
      adapter.fetchEnvelope({
        credentialId: 'c', surfaceKeyId: 'k', scheme: 'ed25519',
      }),
    ).rejects.toBeInstanceOf(ShareEnvelopeHttpError);
    await expect(
      adapter.startEscrow({
        credentialId: 'c', surfaceKeyId: 'k', scheme: 'ed25519',
      }),
    ).rejects.toBeInstanceOf(ShareEnvelopeHttpError);
  });
});
