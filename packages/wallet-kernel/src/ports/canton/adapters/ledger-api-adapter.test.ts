/**
 * Tests for `LedgerApiAdapter`. Pin the wire shape so a refactor that
 * accidentally renames a snake_case field, drops a base64 conversion, or
 * forgets to thread the user_id surfaces here rather than in the first
 * MainNet integration test.
 *
 * No real network — every test injects a `fetch` mock through the adapter's
 * `CantonHttpConfig`.
 */

import { describe, expect, it } from 'vitest';
import { base64Decode, base64Encode } from '../http.ts';
import { LedgerApiAdapter } from './ledger-api-adapter.ts';

function makeAdapter(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
): LedgerApiAdapter {
  return new LedgerApiAdapter({
    ledgerBaseUrl: 'https://canton.test:7575',
    validatorBaseUrl: 'https://canton.test:5003',
    userId: 'tenzro-test-user',
    token: async () => 'auth0-token',
    fetch: async (url, init) => handler(url as string, init),
  });
}

describe('LedgerApiAdapter.prepareSubmission', () => {
  it('threads request fields into the JSON Ledger API wire shape and decodes base64', async () => {
    let seenUrl = '';
    let seenBody: Record<string, unknown> = {};
    const adapter = makeAdapter((url, init) => {
      seenUrl = url;
      seenBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          prepared_transaction: base64Encode(new Uint8Array([1, 2, 3])),
          prepared_transaction_hash: base64Encode(new Uint8Array([0xab, 0xcd])),
          hashing_scheme_version: 'HASHING_SCHEME_VERSION_V2',
        }),
        { status: 200 },
      );
    });
    const res = await adapter.prepareSubmission({
      actAs: 'alice::1220abc',
      synchronizerId: 'global-domain::1220fp',
      commandId: 'cmd-1',
      packageIdSelectionPreference: 'splice-amulet:0.1.17',
      commands: [{ x: 1 }],
    });
    expect(seenUrl).toBe('https://canton.test:7575/v2/interactive-submission/prepare');
    expect(seenBody).toMatchObject({
      user_id: 'tenzro-test-user',
      command_id: 'cmd-1',
      synchronizer_id: 'global-domain::1220fp',
      act_as: ['alice::1220abc'],
      package_id_selection_preference: ['splice-amulet:0.1.17'],
      verbose_hashing: true,
    });
    expect([...res.preparedTransaction]).toEqual([1, 2, 3]);
    expect([...res.preparedTransactionHash]).toEqual([0xab, 0xcd]);
    expect(res.hashingSchemeVersion).toBe('HASHING_SCHEME_VERSION_V2');
  });

  it('rejects unknown hashing scheme versions (V3+)', async () => {
    const adapter = makeAdapter(() =>
      new Response(
        JSON.stringify({
          prepared_transaction: 'AA==',
          prepared_transaction_hash: 'AA==',
          hashing_scheme_version: 'HASHING_SCHEME_VERSION_V3',
        }),
        { status: 200 },
      ),
    );
    await expect(
      adapter.prepareSubmission({
        actAs: 'alice::1220abc',
        synchronizerId: 'global-domain::1220fp',
        commandId: 'cmd-1',
        packageIdSelectionPreference: 'splice-amulet:0.1.17',
        commands: [],
      }),
    ).rejects.toThrow(/HASHING_SCHEME_VERSION_V3/);
  });
});

describe('LedgerApiAdapter.executeSubmission', () => {
  it('base64-encodes preparedTransaction + signature and maps scheme', async () => {
    let seenBody: Record<string, unknown> = {};
    const adapter = makeAdapter((_url, init) => {
      seenBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response('{}', { status: 200 });
    });
    await adapter.executeSubmission({
      preparedTransaction: new Uint8Array([9, 9, 9]),
      partySignatures: [
        {
          party: 'alice::1220abc',
          signature: new Uint8Array([1, 1]),
          scheme: 'ed25519',
          signedBy: 'fp-1',
        },
      ],
      hashingSchemeVersion: 'HASHING_SCHEME_VERSION_V2',
      submissionId: 'cmd-1',
    });
    expect(seenBody.prepared_transaction).toBe(base64Encode(new Uint8Array([9, 9, 9])));
    const sigs = seenBody.party_signatures as ReadonlyArray<Record<string, unknown>>;
    expect(sigs[0]).toMatchObject({
      party: 'alice::1220abc',
      signature: base64Encode(new Uint8Array([1, 1])),
      signing_algorithm_spec: 'ed25519',
      signed_by: 'fp-1',
    });
    expect(seenBody.user_id).toBe('tenzro-test-user');
    expect(seenBody.submission_id).toBe('cmd-1');
  });
});

describe('LedgerApiAdapter.tailCompletions', () => {
  it('maps `status.code === 0` to executed and non-zero to failed with errorMessage', async () => {
    const enc = new TextEncoder();
    const ndjson =
      JSON.stringify({
        completion: {
          command_id: 'cmd-1',
          update_id: 'update-1',
          offset: '0001',
          status: { code: 0 },
        },
      }) +
      '\n' +
      JSON.stringify({
        completion: {
          command_id: 'cmd-2',
          update_id: 'update-2',
          offset: '0002',
          status: { code: 13, message: 'INTERNAL: boom' },
        },
      }) +
      '\n';
    const adapter = makeAdapter(() => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(ndjson));
          c.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    const out: Array<{ commandId: string; status: string; errorMessage?: string }> = [];
    for await (const c of adapter.tailCompletions({
      userId: 'tenzro-test-user',
      actAs: ['alice::1220abc'],
    })) {
      out.push({
        commandId: c.commandId,
        status: c.status,
        ...(c.errorMessage !== undefined ? { errorMessage: c.errorMessage } : {}),
      });
    }
    expect(out).toEqual([
      { commandId: 'cmd-1', status: 'executed' },
      { commandId: 'cmd-2', status: 'failed', errorMessage: 'INTERNAL: boom' },
    ]);
  });
});

describe('LedgerApiAdapter.lookupPreapproval', () => {
  it('parses ISO-8601 expiry to unix milliseconds', async () => {
    const adapter = makeAdapter(() =>
      new Response(
        JSON.stringify({
          transfer_preapproval: {
            contract_id: 'cid-1',
            payload: {
              receiver: 'bob::1220fff',
              provider: 'tenzro::1220val',
              expires_at: '2026-12-31T23:59:59Z',
            },
          },
        }),
        { status: 200 },
      ),
    );
    const r = await adapter.lookupPreapproval('bob::1220fff');
    expect(r).not.toBeNull();
    expect(r?.contractId).toBe('cid-1');
    expect(r?.expiresAt).toBe(Date.parse('2026-12-31T23:59:59Z'));
  });

  it('returns null on 404', async () => {
    const adapter = makeAdapter(() =>
      new Response('not found', { status: 404 }),
    );
    // The adapter currently rethrows `CantonHttpError` (it inspects `status`,
    // not `e.status`). Verify the contract: 404 → null when the error carries
    // the http status.
    const r = await adapter.lookupPreapproval('nobody::1220');
    expect(r).toBeNull();
  });
});

describe('LedgerApiAdapter.generateTopology', () => {
  it('base64-encodes namespace + signing public keys and decodes the response bundle', async () => {
    let seenBody: Record<string, unknown> = {};
    const adapter = makeAdapter((_url, init) => {
      seenBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          topology_transactions: [
            base64Encode(new Uint8Array([1])),
            base64Encode(new Uint8Array([2])),
            base64Encode(new Uint8Array([3])),
          ],
          multi_hash: base64Encode(new Uint8Array([0xff])),
          party_id: 'alice::1220abc',
        }),
        { status: 200 },
      );
    });
    const res = await adapter.generateTopology({
      partyHint: 'alice',
      namespacePublicKey: new Uint8Array([1, 2, 3]),
      signingPublicKeys: [{ publicKey: new Uint8Array([4, 5]), scheme: 'ed25519' }],
      threshold: 1,
    });
    expect(seenBody.party_hint).toBe('alice');
    expect(seenBody.public_key).toBe(base64Encode(new Uint8Array([1, 2, 3])));
    expect(res.topologyTransactions.map((b) => [...b])).toEqual([[1], [2], [3]]);
    expect([...res.bundleHash]).toEqual([0xff]);
    expect(res.partyId).toBe('alice::1220abc');
  });
});
