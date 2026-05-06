/**
 * Pin the RecoveryHttpAdapter wire shape against `/wallet/recover/*`.
 */

import { describe, expect, it } from 'vitest';
import type { TdipDid } from '../types/identity.ts';
import {
  RecoveryHttpAdapter,
  type RecoveryHttpConfig,
  RecoveryHttpError,
} from './recovery-http-adapter.ts';
import type { PasskeyEnrolment } from './wallet-new.ts';

const DID = 'did:tenzro:human:alice' as TdipDid;
const ENROLMENT: PasskeyEnrolment = {
  credentialId: 'cred-b64u',
  attestationObject: 'att-b64u',
  clientDataJson: 'cdj-b64u',
};

interface Captured {
  url: string;
  method: string;
  body: string;
}

function captureFetch(respond: (path: string) => Response): {
  fetch: typeof fetch;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({
      url: url as string,
      method: (init?.method ?? 'GET') as string,
      body: (init?.body as string) ?? '',
    });
    return respond(url as string);
  };
  return { fetch: fetchImpl, calls };
}

function cfg(fetchImpl: typeof fetch, baseUrl = 'https://rpc.tenzro.test'): RecoveryHttpConfig {
  return { baseUrl, fetch: fetchImpl };
}

const B64_BYTES_123 = 'AQID'; // [0x01, 0x02, 0x03]

describe('RecoveryHttpAdapter.start', () => {
  it('encodes email-otp proof and decodes start reply', async () => {
    const { fetch, calls } = captureFetch(
      () =>
        new Response(
          JSON.stringify({
            session_id: 'sess-r',
            challenge_b64: B64_BYTES_123,
            user_handle_b64: B64_BYTES_123,
            user_display_name: 'alice',
          }),
          { status: 200 },
        ),
    );
    const adapter = new RecoveryHttpAdapter(cfg(fetch));
    const r = await adapter.start({
      did: DID,
      proof: { kind: 'email-otp', otp: '123456' },
    });

    expect(r.sessionId).toBe('sess-r');
    expect(Array.from(r.challenge)).toEqual([1, 2, 3]);
    expect(r.userDisplayName).toBe('alice');

    expect(calls[0]?.url).toBe('https://rpc.tenzro.test/wallet/recover/start');
    expect(JSON.parse(calls[0]!.body)).toEqual({
      did: DID,
      proof: { kind: 'email-otp', otp: '123456' },
    });
  });

  it('encodes social proof with base64 signatures', async () => {
    const { fetch, calls } = captureFetch(
      () =>
        new Response(
          JSON.stringify({
            session_id: 's',
            challenge_b64: B64_BYTES_123,
            user_handle_b64: B64_BYTES_123,
            user_display_name: 'a',
          }),
          { status: 200 },
        ),
    );
    const adapter = new RecoveryHttpAdapter(cfg(fetch));
    await adapter.start({
      did: DID,
      proof: {
        kind: 'social',
        delegateSignatures: [
          {
            delegateDid: 'did:tenzro:human:bob' as TdipDid,
            signature: new Uint8Array([1, 2, 3]),
          },
        ],
      },
    });
    const parsed = JSON.parse(calls[0]!.body) as {
      proof: { kind: string; delegate_signatures: Array<Record<string, string>> };
    };
    expect(parsed.proof.kind).toBe('social');
    expect(parsed.proof.delegate_signatures[0]).toEqual({
      delegate_did: 'did:tenzro:human:bob',
      signature_b64: B64_BYTES_123,
    });
  });

  it('encodes tenzro-id-kyc proof', async () => {
    const { fetch, calls } = captureFetch(
      () =>
        new Response(
          JSON.stringify({
            session_id: 's',
            challenge_b64: B64_BYTES_123,
            user_handle_b64: B64_BYTES_123,
            user_display_name: 'a',
          }),
          { status: 200 },
        ),
    );
    const adapter = new RecoveryHttpAdapter(cfg(fetch));
    await adapter.start({
      did: DID,
      proof: { kind: 'tenzro-id-kyc', proofToken: 'persona-token-xyz' },
    });
    expect(JSON.parse(calls[0]!.body)).toEqual({
      did: DID,
      proof: { kind: 'tenzro-id-kyc', proof_token: 'persona-token-xyz' },
    });
  });

  it('passes force_rotate when set', async () => {
    const { fetch, calls } = captureFetch(
      () =>
        new Response(
          JSON.stringify({
            session_id: 's',
            challenge_b64: B64_BYTES_123,
            user_handle_b64: B64_BYTES_123,
            user_display_name: 'a',
          }),
          { status: 200 },
        ),
    );
    const adapter = new RecoveryHttpAdapter(cfg(fetch));
    await adapter.start({
      did: DID,
      proof: { kind: 'email-otp', otp: 'x' },
      forceRotate: true,
    });
    const parsed = JSON.parse(calls[0]!.body) as Record<string, unknown>;
    expect(parsed.force_rotate).toBe(true);
  });

  it('omits force_rotate when not provided', async () => {
    const { fetch, calls } = captureFetch(
      () =>
        new Response(
          JSON.stringify({
            session_id: 's',
            challenge_b64: B64_BYTES_123,
            user_handle_b64: B64_BYTES_123,
            user_display_name: 'a',
          }),
          { status: 200 },
        ),
    );
    const adapter = new RecoveryHttpAdapter(cfg(fetch));
    await adapter.start({ did: DID, proof: { kind: 'email-otp', otp: 'x' } });
    const parsed = JSON.parse(calls[0]!.body) as Record<string, unknown>;
    expect('force_rotate' in parsed).toBe(false);
  });
});

describe('RecoveryHttpAdapter.finalize', () => {
  it('POSTs enrolment and decodes wrapped share', async () => {
    const { fetch, calls } = captureFetch(
      () =>
        new Response(
          JSON.stringify({
            identity: {
              did: DID,
              parts: { method: 'tenzro', kind: 'human', uuid: 'alice' },
              keys: {},
              createdAt: 1_700_000_000_000,
            },
            threshold: { k: 2, n: 3 },
            wrapped_share: {
              credential_id: 'cred-new',
              wrapped_share_b64: B64_BYTES_123,
              alg: 'aes-256-gcm',
              salt_b64: B64_BYTES_123,
            },
          }),
          { status: 200 },
        ),
    );
    const adapter = new RecoveryHttpAdapter(cfg(fetch));
    const r = await adapter.finalize({ sessionId: 'sess-r', enrolment: ENROLMENT });

    expect(r.threshold).toEqual({ k: 2, n: 3 });
    expect(r.wrappedShare.credentialId).toBe('cred-new');
    expect(Array.from(r.wrappedShare.wrappedShare)).toEqual([1, 2, 3]);

    expect(calls[0]?.url).toBe('https://rpc.tenzro.test/wallet/recover/finalize');
    expect(JSON.parse(calls[0]!.body)).toEqual({
      session_id: 'sess-r',
      enrolment: {
        credential_id: 'cred-b64u',
        attestation_object: 'att-b64u',
        client_data_json: 'cdj-b64u',
      },
    });
  });
});

describe('RecoveryHttpAdapter.confirm/cancel', () => {
  it('confirm/cancel resolve on 204', async () => {
    const { fetch, calls } = captureFetch(() => new Response(null, { status: 204 }));
    const adapter = new RecoveryHttpAdapter(cfg(fetch));
    await adapter.confirm({ sessionId: 'sess-r' });
    await adapter.cancel({ sessionId: 'sess-r' });
    expect(calls[0]?.url).toBe('https://rpc.tenzro.test/wallet/recover/confirm');
    expect(calls[1]?.url).toBe('https://rpc.tenzro.test/wallet/recover/cancel');
  });
});

describe('RecoveryHttpAdapter error handling', () => {
  it('throws RecoveryHttpError on non-2xx', async () => {
    const { fetch } = captureFetch(() => new Response('proof rejected', { status: 403 }));
    const adapter = new RecoveryHttpAdapter(cfg(fetch));
    await expect(
      adapter.start({ did: DID, proof: { kind: 'email-otp', otp: 'x' } }),
    ).rejects.toMatchObject({
      name: 'RecoveryHttpError',
      status: 403,
      url: 'https://rpc.tenzro.test/wallet/recover/start',
    });
  });

  it('truncates very long bodies', () => {
    const e = new RecoveryHttpError(500, 'https://x/', 'a'.repeat(500));
    expect(e.message.length).toBeLessThan(280);
  });
});
