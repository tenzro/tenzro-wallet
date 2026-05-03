/**
 * Pin the PairingHttpAdapter wire shape against `/wallet/pairing/*`.
 * No real network — tests inject a `fetch` mock through `PairingHttpConfig`.
 *
 * Focus is on the mappings the kernel relies on:
 *   - request body is snake_case JSON (start/claim/poll/finalize/cancel)
 *   - response is unwrapped from snake_case to camelCase port shape
 *   - optional fields are conditionally spread (not undefined-assigned), so
 *     callers under `exactOptionalPropertyTypes` get clean shapes.
 *   - non-2xx responses surface as `PairingHttpError` with status + body.
 *   - 204 No Content on cancel resolves without parsing JSON.
 *   - trailing slash on baseUrl is normalised.
 */

import { describe, expect, it } from 'vitest';
import {
  PairingHttpAdapter,
  PairingHttpError,
  type PairingHttpConfig,
} from './http-adapter.ts';
import type { PasskeyAssertion } from './port.ts';

const ASSERTION: PasskeyAssertion = {
  credentialId: 'cred-b64u',
  clientDataJson: 'cdj-b64u',
  authenticatorData: 'authdata-b64u',
  signature: 'sig-b64u',
};

interface Captured {
  url: string;
  method: string;
  contentType: string;
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
      contentType:
        (init?.headers as Record<string, string> | undefined)?.['content-type'] ?? '',
      body: (init?.body as string) ?? '',
    });
    return respond(u);
  };
  return { fetch: fetchImpl, calls };
}

function cfg(fetchImpl: typeof fetch, baseUrl = 'https://rpc.tenzro.test'): PairingHttpConfig {
  return { baseUrl, fetch: fetchImpl };
}

describe('PairingHttpAdapter.start', () => {
  it('POSTs JSON body and unwraps to camelCase result', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(
        JSON.stringify({
          session_id: 'sess-1',
          pairing_url: 'https://rpc.tenzro.test/p/abc',
          expires_at: 1_700_000_000_000,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const adapter = new PairingHttpAdapter(cfg(fetch));
    const r = await adapter.start({ did: 'did:tenzro:human:alice', label: 'phone-2' });

    expect(r.sessionId).toBe('sess-1');
    expect(r.pairingUrl).toBe('https://rpc.tenzro.test/p/abc');
    expect(r.expiresAt).toBe(1_700_000_000_000);

    expect(calls[0]?.url).toBe('https://rpc.tenzro.test/wallet/pairing/start');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.contentType).toBe('application/json');
    expect(JSON.parse(calls[0]!.body)).toEqual({
      did: 'did:tenzro:human:alice',
      label: 'phone-2',
    });
  });

  it('omits label when not provided (no undefined in body)', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(
        JSON.stringify({ session_id: 's', pairing_url: 'u', expires_at: 1 }),
        { status: 200 },
      ),
    );
    const adapter = new PairingHttpAdapter(cfg(fetch));
    await adapter.start({ did: 'did:tenzro:human:alice' });
    const parsed = JSON.parse(calls[0]!.body) as Record<string, unknown>;
    expect(parsed).toEqual({ did: 'did:tenzro:human:alice' });
    expect('label' in parsed).toBe(false);
  });

  it('strips trailing slash on baseUrl', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(
        JSON.stringify({ session_id: 's', pairing_url: 'u', expires_at: 1 }),
        { status: 200 },
      ),
    );
    const adapter = new PairingHttpAdapter(cfg(fetch, 'https://rpc.tenzro.test/'));
    await adapter.start({ did: 'did:tenzro:human:alice' });
    expect(calls[0]?.url).toBe('https://rpc.tenzro.test/wallet/pairing/start');
  });
});

describe('PairingHttpAdapter.claim', () => {
  it('POSTs assertion in snake_case and unwraps state', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(
        JSON.stringify({ session_id: 'sess-1', state: 'claimed' }),
        { status: 200 },
      ),
    );
    const adapter = new PairingHttpAdapter(cfg(fetch));
    const r = await adapter.claim({
      sessionId: 'sess-1',
      newDevicePublicKey: 'pubkey-b64u',
      assertion: ASSERTION,
    });
    expect(r.sessionId).toBe('sess-1');
    expect(r.state).toBe('claimed');

    expect(calls[0]?.url).toBe('https://rpc.tenzro.test/wallet/pairing/claim');
    expect(JSON.parse(calls[0]!.body)).toEqual({
      session_id: 'sess-1',
      new_device_public_key: 'pubkey-b64u',
      assertion: {
        credential_id: 'cred-b64u',
        client_data_json: 'cdj-b64u',
        authenticator_data: 'authdata-b64u',
        signature: 'sig-b64u',
      },
    });
  });
});

describe('PairingHttpAdapter.poll', () => {
  it('returns claimedPublicKey when present', async () => {
    const { fetch } = captureFetch(() =>
      new Response(
        JSON.stringify({
          session_id: 'sess-1',
          state: 'claimed',
          claimed_public_key: 'newkey-b64u',
        }),
        { status: 200 },
      ),
    );
    const adapter = new PairingHttpAdapter(cfg(fetch));
    const r = await adapter.poll('sess-1');
    expect(r.state).toBe('claimed');
    expect(r.claimedPublicKey).toBe('newkey-b64u');
    expect('reason' in r).toBe(false);
  });

  it('omits claimedPublicKey/reason when engine omits them (pending)', async () => {
    const { fetch } = captureFetch(() =>
      new Response(
        JSON.stringify({ session_id: 'sess-1', state: 'pending' }),
        { status: 200 },
      ),
    );
    const adapter = new PairingHttpAdapter(cfg(fetch));
    const r = await adapter.poll('sess-1');
    expect(r.state).toBe('pending');
    expect('claimedPublicKey' in r).toBe(false);
    expect('reason' in r).toBe(false);
  });

  it('surfaces reason on cancelled/expired states', async () => {
    const { fetch } = captureFetch(() =>
      new Response(
        JSON.stringify({
          session_id: 'sess-1',
          state: 'expired',
          reason: 'ttl elapsed',
        }),
        { status: 200 },
      ),
    );
    const adapter = new PairingHttpAdapter(cfg(fetch));
    const r = await adapter.poll('sess-1');
    expect(r.state).toBe('expired');
    expect(r.reason).toBe('ttl elapsed');
  });
});

describe('PairingHttpAdapter.finalize', () => {
  it('POSTs originalDeviceAssertion and maps verificationMethods', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(
        JSON.stringify({
          session_id: 'sess-1',
          verification_methods: [
            {
              id: 'did:tenzro:human:alice#key-1',
              type: 'Multikey',
              controller: 'did:tenzro:human:alice',
              public_key_multibase: 'z6Mk-orig',
            },
            {
              id: 'did:tenzro:human:alice#key-2',
              type: 'Multikey',
              controller: 'did:tenzro:human:alice',
              public_key_multibase: 'z6Mk-new',
            },
            {
              id: 'did:tenzro:human:alice#node-tee',
              type: 'Multikey',
              controller: 'did:tenzro:node:tee',
              public_key_multibase: 'z6Mk-tee',
            },
          ],
          threshold: '2-of-3',
        }),
        { status: 200 },
      ),
    );
    const adapter = new PairingHttpAdapter(cfg(fetch));
    const r = await adapter.finalize({
      sessionId: 'sess-1',
      originalDeviceAssertion: ASSERTION,
    });

    expect(r.sessionId).toBe('sess-1');
    expect(r.threshold).toBe('2-of-3');
    expect(r.verificationMethods).toHaveLength(3);
    expect(r.verificationMethods[0]).toEqual({
      id: 'did:tenzro:human:alice#key-1',
      type: 'Multikey',
      controller: 'did:tenzro:human:alice',
      publicKeyMultibase: 'z6Mk-orig',
    });

    expect(calls[0]?.url).toBe('https://rpc.tenzro.test/wallet/pairing/finalize');
    expect(JSON.parse(calls[0]!.body)).toEqual({
      session_id: 'sess-1',
      original_device_assertion: {
        credential_id: 'cred-b64u',
        client_data_json: 'cdj-b64u',
        authenticator_data: 'authdata-b64u',
        signature: 'sig-b64u',
      },
    });
  });
});

describe('PairingHttpAdapter.cancel', () => {
  it('resolves without parsing on 204 No Content', async () => {
    const { fetch, calls } = captureFetch(() => new Response(null, { status: 204 }));
    const adapter = new PairingHttpAdapter(cfg(fetch));
    await expect(adapter.cancel('sess-1')).resolves.toBeUndefined();
    expect(calls[0]?.url).toBe('https://rpc.tenzro.test/wallet/pairing/cancel');
    expect(JSON.parse(calls[0]!.body)).toEqual({ session_id: 'sess-1' });
  });
});

describe('PairingHttpAdapter error handling', () => {
  it('throws PairingHttpError with status and url on non-2xx', async () => {
    const { fetch } = captureFetch(
      () => new Response('session not found', { status: 404 }),
    );
    const adapter = new PairingHttpAdapter(cfg(fetch));
    await expect(adapter.poll('missing')).rejects.toMatchObject({
      name: 'PairingHttpError',
      status: 404,
      url: 'https://rpc.tenzro.test/wallet/pairing/poll',
    });
  });

  it('PairingHttpError truncates very long bodies in its message', () => {
    const e = new PairingHttpError(500, 'https://x/', 'a'.repeat(500));
    expect(e.message.length).toBeLessThan(280);
    expect(e.message).toContain('500');
    expect(e.message).toContain('https://x/');
  });
});
