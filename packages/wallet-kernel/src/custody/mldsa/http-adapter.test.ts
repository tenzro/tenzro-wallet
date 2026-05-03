/**
 * Pin the MlDsaHttpAdapter wire shape against `/wallet/mldsa/*`.
 * No real network — `fetch` is captured.
 *
 * Focus is the kernel-relied mappings:
 *   - `capabilities()` issues a GET (no body, no content-type) and
 *     unwraps `{mode, public_key?}` → `{mode, publicKey?}`;
 *   - `sign()` POSTs snake_case JSON with `_b64`-suffixed bytes fields;
 *   - response `signature_b64` decodes to `Uint8Array` at the boundary;
 *   - optional `purpose` / `public_key` fields are conditionally spread;
 *   - non-2xx surfaces as `MlDsaHttpError`;
 *   - trailing slashes on baseUrl are normalised;
 *   - per-request `headers()` callback is awaited and merged.
 */

import { describe, expect, it } from 'vitest';
import {
  MlDsaHttpAdapter,
  MlDsaHttpError,
  type MlDsaHttpConfig,
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
  extra: Partial<MlDsaHttpConfig> = {},
): MlDsaHttpConfig {
  return { baseUrl: 'https://rpc.tenzro.test', fetch: fetchImpl, ...extra };
}

const PREIMAGE = new Uint8Array([1, 2, 3, 4]);
const PREIMAGE_B64 = 'AQIDBA==';

describe('MlDsaHttpAdapter.capabilities', () => {
  it('GETs /wallet/mldsa/capabilities and unwraps mode + publicKey', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(
        JSON.stringify({ mode: 'tee-only', public_key: 'z6Mk…abc' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const adapter = new MlDsaHttpAdapter(cfg(fetch));
    const r = await adapter.capabilities();

    expect(r.mode).toBe('tee-only');
    expect(r.publicKey).toBe('z6Mk…abc');

    expect(calls[0]?.url).toBe('https://rpc.tenzro.test/wallet/mldsa/capabilities');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.body).toBe('');
    // No content-type on a GET — only set on POST writes.
    expect(calls[0]?.headers['content-type']).toBeUndefined();
  });

  it('omits publicKey when node has not bound one yet', async () => {
    const { fetch } = captureFetch(() =>
      new Response(JSON.stringify({ mode: 'tee-only' })),
    );
    const adapter = new MlDsaHttpAdapter(cfg(fetch));
    const r = await adapter.capabilities();
    expect(r.mode).toBe('tee-only');
    expect(r.publicKey).toBeUndefined();
    expect('publicKey' in r).toBe(false);
  });

  it('passes through threshold mode unchanged', async () => {
    const { fetch } = captureFetch(() =>
      new Response(JSON.stringify({ mode: 'threshold', public_key: 'z6Mk…' })),
    );
    const adapter = new MlDsaHttpAdapter(cfg(fetch));
    const r = await adapter.capabilities();
    expect(r.mode).toBe('threshold');
  });
});

describe('MlDsaHttpAdapter.sign', () => {
  it('POSTs snake_case body with preimage_b64 and decodes signature_b64', async () => {
    // signature filled with 0xAB × 4
    const sigBytes = new Uint8Array(4).fill(0xab);
    const sigB64 = btoa(String.fromCharCode(...sigBytes));
    const { fetch, calls } = captureFetch(() =>
      new Response(JSON.stringify({ signature_b64: sigB64 })),
    );

    const adapter = new MlDsaHttpAdapter(cfg(fetch));
    const r = await adapter.sign({
      did: 'did:tenzro:human:alice',
      surfaceKey: 'tenzro-native#0',
      preimage: PREIMAGE,
      purpose: 'tenzro-native-send',
    });

    expect(Array.from(r.signature)).toEqual([0xab, 0xab, 0xab, 0xab]);

    expect(calls[0]?.url).toBe('https://rpc.tenzro.test/wallet/mldsa/sign');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(calls[0]!.body)).toEqual({
      did: 'did:tenzro:human:alice',
      surface_key: 'tenzro-native#0',
      preimage_b64: PREIMAGE_B64,
      purpose: 'tenzro-native-send',
    });
  });

  it('omits purpose when not provided (no undefined in body)', async () => {
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(4)));
    const { fetch, calls } = captureFetch(() =>
      new Response(JSON.stringify({ signature_b64: sigB64 })),
    );
    const adapter = new MlDsaHttpAdapter(cfg(fetch));
    await adapter.sign({
      did: 'd',
      surfaceKey: 'k',
      preimage: PREIMAGE,
    });
    expect(JSON.parse(calls[0]!.body)).toEqual({
      did: 'd',
      surface_key: 'k',
      preimage_b64: PREIMAGE_B64,
    });
  });
});

describe('MlDsaHttpAdapter — config knobs', () => {
  it('normalises trailing slash on baseUrl', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(JSON.stringify({ mode: 'tee-only' })),
    );
    const adapter = new MlDsaHttpAdapter(
      cfg(fetch, { baseUrl: 'https://rpc.tenzro.test///' }),
    );
    await adapter.capabilities();
    expect(calls[0]?.url).toBe('https://rpc.tenzro.test/wallet/mldsa/capabilities');
  });

  it('awaits headers() and merges into request', async () => {
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(4)));
    const { fetch, calls } = captureFetch(() =>
      new Response(JSON.stringify({ signature_b64: sigB64 })),
    );
    const adapter = new MlDsaHttpAdapter(
      cfg(fetch, {
        headers: async () => ({ Authorization: 'DPoP tok', 'X-Trace': 'abc' }),
      }),
    );
    await adapter.sign({
      did: 'd', surfaceKey: 'k', preimage: PREIMAGE,
    });
    expect(calls[0]?.headers).toEqual({
      'content-type': 'application/json',
      Authorization: 'DPoP tok',
      'X-Trace': 'abc',
    });
  });

  it('sends headers on GET without content-type', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(JSON.stringify({ mode: 'tee-only' })),
    );
    const adapter = new MlDsaHttpAdapter(
      cfg(fetch, { headers: () => ({ Authorization: 'DPoP tok' }) }),
    );
    await adapter.capabilities();
    expect(calls[0]?.headers).toEqual({ Authorization: 'DPoP tok' });
  });
});

describe('MlDsaHttpAdapter error handling', () => {
  it('throws MlDsaHttpError on non-2xx', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('tee unavailable', { status: 503 });
    const adapter = new MlDsaHttpAdapter(cfg(fetchImpl));
    await expect(adapter.capabilities()).rejects.toBeInstanceOf(MlDsaHttpError);
    await expect(
      adapter.sign({ did: 'd', surfaceKey: 'k', preimage: PREIMAGE }),
    ).rejects.toBeInstanceOf(MlDsaHttpError);
  });
});
