/**
 * Pin the FrostHttpAdapter wire shape against `/wallet/frost/*`.
 * No real network — `fetch` is captured.
 *
 * Focus is the kernel-relied mappings:
 *   - curve segment in path matches `start({scheme})` and is reused for
 *     subsequent calls without re-pinning;
 *   - calling any method before `start()` throws (no silent default);
 *   - request body is snake_case JSON with `_b64`-suffixed bytes fields;
 *   - response is unwrapped to camelCase + `Uint8Array` at the boundary;
 *   - optional fields (`purpose`, `reason`, `signature_b64`) are
 *     conditionally spread, not undefined-assigned;
 *   - non-2xx surfaces as `FrostHttpError`;
 *   - 204 No Content on `abort` resolves without parsing JSON;
 *   - trailing slashes on baseUrl are normalised;
 *   - per-request `headers()` callback is awaited and merged.
 */

import { describe, expect, it } from 'vitest';
import {
  FrostHttpAdapter,
  FrostHttpError,
  type FrostHttpConfig,
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
  extra: Partial<FrostHttpConfig> = {},
): FrostHttpConfig {
  return { baseUrl: 'https://rpc.tenzro.test', fetch: fetchImpl, ...extra };
}

const PREIMAGE = new Uint8Array([1, 2, 3, 4]);
// `bytesToBase64` of [1,2,3,4]
const PREIMAGE_B64 = 'AQIDBA==';

describe('FrostHttpAdapter.start', () => {
  it('POSTs to /wallet/frost/<scheme>/start and unwraps to camelCase', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(
        JSON.stringify({
          session_id: 's-1',
          expires_at: 1_700_000_000_000,
          participants: ['device-A', 'node-tee'],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const adapter = new FrostHttpAdapter(cfg(fetch));
    const r = await adapter.start({
      did: 'did:tenzro:human:alice',
      surfaceKey: 'tenzro-native#0',
      scheme: 'ed25519',
      preimage: PREIMAGE,
      purpose: 'tenzro-native-send',
    });

    expect(r.sessionId).toBe('s-1');
    expect(r.expiresAt).toBe(1_700_000_000_000);
    expect(r.participants).toEqual(['device-A', 'node-tee']);

    expect(calls[0]?.url).toBe('https://rpc.tenzro.test/wallet/frost/ed25519/start');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(calls[0]!.body)).toEqual({
      did: 'did:tenzro:human:alice',
      surface_key: 'tenzro-native#0',
      scheme: 'ed25519',
      preimage_b64: PREIMAGE_B64,
      purpose: 'tenzro-native-send',
    });
  });

  it('omits purpose when not provided (no undefined in body)', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(
        JSON.stringify({ session_id: 's', expires_at: 1, participants: [] }),
        { status: 200 },
      ),
    );
    const adapter = new FrostHttpAdapter(cfg(fetch));
    await adapter.start({
      did: 'd', surfaceKey: 'k', scheme: 'ed25519', preimage: PREIMAGE,
    });
    expect(JSON.parse(calls[0]!.body)).toEqual({
      did: 'd', surface_key: 'k', scheme: 'ed25519', preimage_b64: PREIMAGE_B64,
    });
  });

  it('routes secp256k1 path when scheme is secp256k1', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(
        JSON.stringify({ session_id: 's', expires_at: 1, participants: [] }),
      ),
    );
    const adapter = new FrostHttpAdapter(cfg(fetch));
    await adapter.start({
      did: 'd', surfaceKey: 'k', scheme: 'secp256k1', preimage: PREIMAGE,
    });
    expect(calls[0]?.url).toBe(
      'https://rpc.tenzro.test/wallet/frost/secp256k1/start',
    );
  });

  it('normalises trailing slash on baseUrl', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(
        JSON.stringify({ session_id: 's', expires_at: 1, participants: [] }),
      ),
    );
    const adapter = new FrostHttpAdapter(
      cfg(fetch, { baseUrl: 'https://rpc.tenzro.test///' }),
    );
    await adapter.start({
      did: 'd', surfaceKey: 'k', scheme: 'ed25519', preimage: PREIMAGE,
    });
    expect(calls[0]?.url).toBe('https://rpc.tenzro.test/wallet/frost/ed25519/start');
  });

  it('awaits headers() and merges into request', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(
        JSON.stringify({ session_id: 's', expires_at: 1, participants: [] }),
      ),
    );
    const adapter = new FrostHttpAdapter(
      cfg(fetch, {
        headers: async () => ({ Authorization: 'DPoP tok', 'X-Trace': 'abc' }),
      }),
    );
    await adapter.start({
      did: 'd', surfaceKey: 'k', scheme: 'ed25519', preimage: PREIMAGE,
    });
    expect(calls[0]?.headers).toEqual({
      'content-type': 'application/json',
      Authorization: 'DPoP tok',
      'X-Trace': 'abc',
    });
  });
});

describe('FrostHttpAdapter.commit / awaitChallenge / respond', () => {
  it('encodes commit/respond bytes as _b64 fields and decodes challenge bytes', async () => {
    const calls: Captured[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const u = url as string;
      calls.push({
        url: u, method: 'POST',
        headers: (init?.headers as Record<string, string>) ?? {},
        body: (init?.body as string) ?? '',
      });
      if (u.endsWith('/start')) {
        return new Response(
          JSON.stringify({ session_id: 's-2', expires_at: 1, participants: [] }),
        );
      }
      if (u.endsWith('/commit')) {
        return new Response(
          JSON.stringify({ session_id: 's-2', state: 'pending' }),
        );
      }
      if (u.endsWith('/await-challenge')) {
        // group_commitment = [9,9,9], lambda = [4,4]
        return new Response(
          JSON.stringify({
            session_id: 's-2',
            state: 'committed',
            group_commitment_b64: 'CQkJ',
            signer_set: ['device-A', 'node-tee'],
            lambda_b64: 'BAQ=',
          }),
        );
      }
      if (u.endsWith('/respond')) {
        return new Response(
          JSON.stringify({ session_id: 's-2', state: 'responded' }),
        );
      }
      throw new Error(`unexpected url: ${u}`);
    };

    const adapter = new FrostHttpAdapter(cfg(fetchImpl));
    await adapter.start({
      did: 'd', surfaceKey: 'k', scheme: 'ed25519', preimage: PREIMAGE,
    });

    const c = await adapter.commit({
      sessionId: 's-2',
      deviceCommitment: new Uint8Array([5, 5, 5]),
    });
    expect(c.state).toBe('pending');
    expect(JSON.parse(calls[1]!.body)).toEqual({
      session_id: 's-2',
      device_commitment_b64: 'BQUF',
    });

    const ch = await adapter.awaitChallenge('s-2');
    expect(ch.state).toBe('committed');
    expect(Array.from(ch.groupCommitment)).toEqual([9, 9, 9]);
    expect(Array.from(ch.lambda)).toEqual([4, 4]);
    expect(ch.signerSet).toEqual(['device-A', 'node-tee']);

    const r = await adapter.respond({
      sessionId: 's-2',
      deviceShare: new Uint8Array([7, 7]),
    });
    expect(r.state).toBe('responded');
    expect(JSON.parse(calls[3]!.body)).toEqual({
      session_id: 's-2',
      device_share_b64: 'Bwc=',
    });
  });
});

describe('FrostHttpAdapter.finalize', () => {
  it('decodes signature_b64 when present', async () => {
    const calls: Captured[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const u = url as string;
      calls.push({ url: u, method: 'POST', headers: {}, body: '' });
      if (u.endsWith('/start')) {
        return new Response(
          JSON.stringify({ session_id: 's', expires_at: 1, participants: [] }),
        );
      }
      // 64-byte signature: filled with 0xAB, 0xCD repeating — simple b64 fixture
      const sigBytes = new Uint8Array(4).fill(0xab);
      const b64 = btoa(String.fromCharCode(...sigBytes));
      return new Response(
        JSON.stringify({
          session_id: 's',
          state: 'finalized',
          signature_b64: b64,
        }),
      );
    };

    const adapter = new FrostHttpAdapter(cfg(fetchImpl));
    await adapter.start({
      did: 'd', surfaceKey: 'k', scheme: 'ed25519', preimage: PREIMAGE,
    });
    const f = await adapter.finalize('s');
    expect(f.state).toBe('finalized');
    expect(f.signature).toBeDefined();
    expect(Array.from(f.signature!)).toEqual([0xab, 0xab, 0xab, 0xab]);
  });

  it('omits signature when state is not finalized', async () => {
    const fetchImpl: typeof fetch = async (url) => {
      const u = url as string;
      if (u.endsWith('/start')) {
        return new Response(
          JSON.stringify({ session_id: 's', expires_at: 1, participants: [] }),
        );
      }
      return new Response(
        JSON.stringify({ session_id: 's', state: 'pending' }),
      );
    };
    const adapter = new FrostHttpAdapter(cfg(fetchImpl));
    await adapter.start({
      did: 'd', surfaceKey: 'k', scheme: 'ed25519', preimage: PREIMAGE,
    });
    const f = await adapter.finalize('s');
    expect(f.state).toBe('pending');
    expect(f.signature).toBeUndefined();
  });
});

describe('FrostHttpAdapter.abort', () => {
  it('omits reason when not provided and resolves on 204', async () => {
    const calls: Captured[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const u = url as string;
      calls.push({
        url: u, method: 'POST', headers: {}, body: (init?.body as string) ?? '',
      });
      if (u.endsWith('/start')) {
        return new Response(
          JSON.stringify({ session_id: 's', expires_at: 1, participants: [] }),
        );
      }
      // 204 No Content
      return new Response(null, { status: 204 });
    };
    const adapter = new FrostHttpAdapter(cfg(fetchImpl));
    await adapter.start({
      did: 'd', surfaceKey: 'k', scheme: 'ed25519', preimage: PREIMAGE,
    });
    await adapter.abort('s');
    expect(JSON.parse(calls[1]!.body)).toEqual({ session_id: 's' });
  });

  it('forwards reason when provided', async () => {
    const calls: Captured[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const u = url as string;
      calls.push({
        url: u, method: 'POST', headers: {}, body: (init?.body as string) ?? '',
      });
      if (u.endsWith('/start')) {
        return new Response(
          JSON.stringify({ session_id: 's', expires_at: 1, participants: [] }),
        );
      }
      return new Response(null, { status: 204 });
    };
    const adapter = new FrostHttpAdapter(cfg(fetchImpl));
    await adapter.start({
      did: 'd', surfaceKey: 'k', scheme: 'ed25519', preimage: PREIMAGE,
    });
    await adapter.abort('s', 'user-cancelled');
    expect(JSON.parse(calls[1]!.body)).toEqual({
      session_id: 's',
      reason: 'user-cancelled',
    });
  });
});

describe('FrostHttpAdapter error handling', () => {
  it('throws if any method called before start()', async () => {
    const adapter = new FrostHttpAdapter(cfg(async () => new Response('no')));
    await expect(adapter.commit({ sessionId: 's', deviceCommitment: new Uint8Array(0) }))
      .rejects.toThrow(/cannot call commit before start/);
    await expect(adapter.awaitChallenge('s'))
      .rejects.toThrow(/cannot call await-challenge before start/);
  });

  it('throws FrostHttpError on non-2xx', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('quorum unavailable', { status: 503 });
    const adapter = new FrostHttpAdapter(cfg(fetchImpl));
    await expect(
      adapter.start({
        did: 'd', surfaceKey: 'k', scheme: 'ed25519', preimage: PREIMAGE,
      }),
    ).rejects.toBeInstanceOf(FrostHttpError);
  });
});
