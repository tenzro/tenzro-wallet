/**
 * TDIP DID parsing/formatting. Pure functions, no side effects.
 *
 * Forms:
 *   did:tenzro:human:{uuid}
 *   did:tenzro:machine:{uuid}                       — autonomous
 *   did:tenzro:machine:{controller-did-uuid}:{uuid} — controlled-machine
 */

import type { TdipDid, TdipDidParts, TdipKind } from '../types/identity.ts';

const DID_PREFIX = 'did:tenzro:';

export function asTdipDid(s: string): TdipDid {
  parseTdipDid(s); // throws if malformed
  return s as TdipDid;
}

export function parseTdipDid(s: string): TdipDidParts {
  if (!s.startsWith(DID_PREFIX)) {
    throw new Error(`not a tenzro DID: ${s}`);
  }
  const rest = s.slice(DID_PREFIX.length);
  const parts = rest.split(':');
  const [kindRaw, ...tail] = parts;

  switch (kindRaw) {
    case 'human': {
      if (tail.length !== 1 || !tail[0]) throw new Error(`malformed human DID: ${s}`);
      return { method: 'tenzro', kind: 'human', uuid: tail[0] };
    }
    case 'machine': {
      if (tail.length === 1 && tail[0]) {
        return { method: 'tenzro', kind: 'autonomous-machine', uuid: tail[0] };
      }
      if (tail.length === 2 && tail[0] && tail[1]) {
        const controller = `${DID_PREFIX}human:${tail[0]}` as TdipDid;
        return {
          method: 'tenzro',
          kind: 'controlled-machine',
          controller,
          uuid: tail[1],
        };
      }
      throw new Error(`malformed machine DID: ${s}`);
    }
    default:
      throw new Error(`unknown TDIP kind: ${kindRaw}`);
  }
}

export function formatTdipDid(parts: {
  kind: TdipKind;
  controller?: TdipDid | undefined;
  uuid: string;
}): TdipDid {
  switch (parts.kind) {
    case 'human':
      return `${DID_PREFIX}human:${parts.uuid}` as TdipDid;
    case 'autonomous-machine':
      return `${DID_PREFIX}machine:${parts.uuid}` as TdipDid;
    case 'controlled-machine': {
      if (!parts.controller) throw new Error('controlled-machine requires controller');
      const ctrl = parseTdipDid(parts.controller);
      return `${DID_PREFIX}machine:${ctrl.uuid}:${parts.uuid}` as TdipDid;
    }
  }
}
