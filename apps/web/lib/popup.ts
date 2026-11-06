/**
 * Sites use the wallet through a popup at `/approve`. The site opens it,
 * waits for `ready`, and posts one request at a time; the wallet answers to
 * that site's exact origin only. Every request is shown to the person, with
 * the site's origin, before a passkey signs anything.
 *
 * Request:  { protocol, type: 'request', id, method, params? }
 * Response: { protocol, type: 'response', id, result? | error? }
 */

import type { TypedTransaction } from 'tenzro-sdk';

export const POPUP_PROTOCOL = 'tenzro-wallet/popup/v1';

export type PopupMethod = 'tenzro_connect' | 'tenzro_sendTransaction' | 'tenzro_disconnect';

export interface PopupRequest {
  readonly id: string;
  readonly method: PopupMethod;
  readonly params?: unknown;
}

export interface PopupError {
  readonly code: number;
  readonly message: string;
}

export const USER_REJECTED: PopupError = { code: 4001, message: 'The person declined.' };
export const UNSUPPORTED: PopupError = { code: 4200, message: 'The wallet does not offer this.' };

const METHODS: readonly string[] = [
  'tenzro_connect',
  'tenzro_sendTransaction',
  'tenzro_disconnect',
];

/** A request from the opener, or the error to answer it with, or null to ignore the message. */
export function readRequest(
  data: unknown,
): { request: PopupRequest } | { id: string; error: PopupError } | null {
  const m = data as { protocol?: unknown; type?: unknown; id?: unknown; method?: unknown };
  if (!m || m.protocol !== POPUP_PROTOCOL || m.type !== 'request' || typeof m.id !== 'string') {
    return null;
  }
  if (typeof m.method !== 'string' || !METHODS.includes(m.method)) {
    return { id: m.id, error: UNSUPPORTED };
  }
  return {
    request: {
      id: m.id,
      method: m.method as PopupMethod,
      params: (data as { params?: unknown }).params,
    },
  };
}

/** The transaction a site asks the wallet to send, checked for shape. */
export function readTransaction(params: unknown): TypedTransaction {
  const tx = params as Partial<TypedTransaction> | null;
  if (!tx || typeof tx.kind !== 'string' || (tx.fields !== null && typeof tx.fields !== 'object')) {
    throw new Error('The site sent a transaction the wallet cannot read.');
  }
  if (tx.from !== undefined) throw new Error('A site cannot choose the sending account.');
  return {
    kind: tx.kind,
    fields: tx.fields ?? null,
    ...(tx.to ? { to: tx.to } : {}),
    ...(tx.gasLimit ? { gasLimit: tx.gasLimit } : {}),
  } as TypedTransaction;
}

export function response(id: string, body: { result: unknown } | { error: PopupError }) {
  return { protocol: POPUP_PROTOCOL, type: 'response' as const, id, ...body };
}
