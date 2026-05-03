/**
 * Route selection. Given a SendIntent, choose the source surface and the
 * route shape (native-on-surface, cross-VM pointer, or external bridge).
 *
 * The wallet's UX promise hinges on this: pointer ops within Tenzro must NOT
 * be presented as bridges, must NOT charge a bridge fee, and must NOT show a
 * "lock-and-mint" confirmation. Bridges are reserved for moves that genuinely
 * cross ledgers.
 */

import type { Intent, Route } from '../types/intent.ts';
import { SURFACE_IS_ON_TENZRO, type SurfaceName } from '../types/surface.ts';

export interface RouteSelection {
  readonly route: Route;
  readonly fromSurface: SurfaceName;
}

export function selectRoute(intent: Intent): RouteSelection {
  if (intent.kind !== 'send') {
    throw new Error(`route selection unsupported for intent: ${intent.kind}`);
  }
  const fromSurface = intent.fromSurface ?? inferFromSurface(intent);
  const toSurface = inferToSurface(intent);

  if (fromSurface === toSurface) {
    return { fromSurface, route: { kind: 'native', surface: fromSurface } };
  }

  // Both surfaces inside the Tenzro runtime → pointer op, no bridge.
  if (SURFACE_IS_ON_TENZRO[fromSurface] && SURFACE_IS_ON_TENZRO[toSurface]) {
    return {
      fromSurface,
      route: {
        kind: 'cross-vm-pointer',
        fromSurface,
        toSurface,
        precompile: '0x1003',
      },
    };
  }

  // Otherwise we cross a real ledger boundary — pick a bridge adapter.
  return {
    fromSurface,
    route: {
      kind: 'bridge',
      fromSurface,
      toSurface,
      adapter: pickBridgeAdapter(fromSurface, toSurface),
    },
  };
}

function inferFromSurface(intent: Extract<Intent, { kind: 'send' }>): SurfaceName {
  switch (intent.asset.scope) {
    case 'tenzro-native':
      return 'tenzro-native';
    case 'tenzro-asset':
      return 'tenzro-native';
    case 'external-evm':
      return 'evm-on-tenzro'; // bridged in via EVM by default
    case 'external-svm':
      return 'svm-on-tenzro';
    case 'canton-mainnet':
      return 'canton-external';
  }
}

function inferToSurface(intent: Extract<Intent, { kind: 'send' }>): SurfaceName {
  switch (intent.to.kind) {
    case 'tdip':
      return 'tenzro-native';
    case 'evm':
      return 'evm-on-tenzro';
    case 'svm':
      return 'svm-on-tenzro';
    case 'canton':
      // Without more context, Canton MainNet is the safer default — internal
      // Canton routing is typically requested explicitly via fromSurface.
      return 'canton-external';
  }
}

function pickBridgeAdapter(
  from: SurfaceName,
  to: SurfaceName,
): Extract<Route, { kind: 'bridge' }>['adapter'] {
  // M1 heuristic: Canton-external goes through the Canton adapter; everything
  // else defaults to LI.FI (the aggregator picks underlying bridges).
  if (from === 'canton-external' || to === 'canton-external') return 'canton-adapter';
  return 'lifi';
}
