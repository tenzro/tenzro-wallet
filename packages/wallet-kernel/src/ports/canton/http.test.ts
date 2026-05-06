/**
 * Tests for the Canton HTTP helpers. Focus is on the parts the adapter
 * relies on but which aren't visible from the adapter's call sites:
 *   - bigint and Uint8Array marshalling on the JSON body.
 *   - Authorization header threading (per-request token call).
 *   - NDJSON line splitting across `read()` chunk boundaries.
 *   - Error path produces `CantonHttpError` with status + body.
 *
 * No real network — the tests inject a `fetch` mock through `CantonHttpConfig`.
 */

import { describe, expect, it } from 'vitest';
import {
  type CantonHttpConfig,
  CantonHttpError,
  base64Decode,
  base64Encode,
  postJson,
  streamNdjson,
} from './http.ts';

function makeCfg(fetchImpl: typeof fetch, tokenCalls: string[] = []): CantonHttpConfig {
  return {
    ledgerBaseUrl: 'https://canton.test:7575',
    validatorBaseUrl: 'https://canton.test:5003',
    token: async () => {
      const t = `tok-${tokenCalls.length + 1}`;
      tokenCalls.push(t);
      return t;
    },
    fetch: fetchImpl,
  };
}

describe('canton http: postJson', () => {
  it('routes ledger-base requests to ledgerBaseUrl with bearer token', async () => {
    let seenUrl = '';
    let seenAuth = '';
    let seenBody = '';
    const f: typeof fetch = async (url, init) => {
      seenUrl = url as string;
      seenAuth = (init?.headers as Record<string, string>)?.authorization ?? '';
      seenBody = (init?.body as string) ?? '';
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const cfg = makeCfg(f);
    const res = await postJson<{ x: number }, { ok: boolean }>(cfg, 'ledger', '/v2/foo', { x: 1 });
    expect(res.ok).toBe(true);
    expect(seenUrl).toBe('https://canton.test:7575/v2/foo');
    expect(seenAuth).toBe('Bearer tok-1');
    expect(seenBody).toBe('{"x":1}');
  });

  it('routes validator-base requests to validatorBaseUrl', async () => {
    let seenUrl = '';
    const f: typeof fetch = async (url) => {
      seenUrl = url as string;
      return new Response('{}', { status: 200 });
    };
    await postJson(makeCfg(f), 'validator', '/api/validator/v0/foo', {});
    expect(seenUrl).toBe('https://canton.test:5003/api/validator/v0/foo');
  });

  it('marshals bigint as decimal string and Uint8Array as base64', async () => {
    let seenBody = '';
    const f: typeof fetch = async (_url, init) => {
      seenBody = (init?.body as string) ?? '';
      return new Response('{}', { status: 200 });
    };
    await postJson(makeCfg(f), 'ledger', '/v2/foo', {
      amount: 12345n,
      blob: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    });
    const parsed = JSON.parse(seenBody) as { amount: string; blob: string };
    expect(parsed.amount).toBe('12345');
    expect(parsed.blob).toBe(base64Encode(new Uint8Array([0xde, 0xad, 0xbe, 0xef])));
  });

  it('throws CantonHttpError with status and body on non-2xx', async () => {
    const f: typeof fetch = async () =>
      new Response('boom', { status: 503, statusText: 'service unavailable' });
    await expect(postJson(makeCfg(f), 'ledger', '/v2/foo', {})).rejects.toMatchObject({
      name: 'CantonHttpError',
      status: 503,
    });
  });

  it('CantonHttpError truncates very long bodies in its message', () => {
    const e = new CantonHttpError(500, 'http://x', 'a'.repeat(500));
    expect(e.message.length).toBeLessThan(280);
  });
});

describe('canton http: streamNdjson', () => {
  it('splits NDJSON lines correctly across ReadableStream chunk boundaries', async () => {
    // Build a stream that delivers `{"a":1}\n{"a":2}\n{"a":3}` split mid-line.
    const enc = new TextEncoder();
    const chunks = [enc.encode('{"a":1}\n{"a'), enc.encode('":2}\n{"a":3}\n')];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
    const f: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
    const out: { a: number }[] = [];
    for await (const el of streamNdjson<{ a: number }>(makeCfg(f), 'ledger', '/v2/stream', {})) {
      out.push(el);
    }
    expect(out).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('flushes a trailing line with no terminating newline', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('{"k":1}\n{"k":2}'));
        controller.close();
      },
    });
    const f: typeof fetch = async () => new Response(body, { status: 200 });
    const out: { k: number }[] = [];
    for await (const el of streamNdjson<{ k: number }>(makeCfg(f), 'ledger', '/v2/x', {})) {
      out.push(el);
    }
    expect(out).toEqual([{ k: 1 }, { k: 2 }]);
  });
});

describe('canton http: base64', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 254, 255, 127, 128]);
    const enc = base64Encode(bytes);
    const dec = base64Decode(enc);
    expect([...dec]).toEqual([...bytes]);
  });
});
