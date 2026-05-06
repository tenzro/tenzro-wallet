/**
 * Smart-send orchestration: turn `(recipient, amount)` into the right
 * sequence of testnet RPCs without making the user think about VM
 * projections, wrapping, or which bridge vendor to pick.
 *
 * The decision tree:
 *
 *  detect(recipient)
 *    ├─ tenzro (32-byte hex)
 *    │     → tenzro_signAndSendTransaction (one shot, native ledger)
 *    ├─ evm (20-byte 0x)
 *    │     → bridge required (off-Tenzro chain)
 *    │     → tenzro_bridgeTokens (LayerZero V2)
 *    │       — needs explicit dest_chain because the address alone is
 *    │         ambiguous between Ethereum / Base / Polygon / etc.
 *    ├─ svm (base58)
 *    │     → tenzro_bridgeTokens with dest_chain='solana'
 *    └─ unknown → reject
 *
 * Cross-VM transfers and `wrapTnzo` aren't exposed as separate user
 * flows — the orchestrator inserts them automatically when needed
 * (e.g. user has balance on the EVM projection but is sending to a
 * native-Tenzro recipient).
 */

import { type AddressKind, detectAddress } from './address';
import type { TenzroVm, TokenBalances } from './methods';

/** A bridge destination the user can pick when the address is EVM. */
export interface BridgeDestination {
  readonly id: string;
  readonly label: string;
  readonly surface: 'evm' | 'svm';
}

/**
 * Hardcoded list of bridge destinations the testnet's pointer model
 * advertises. `tenzro_listChains` returns empty today — these are the
 * candidate destinations the user can pick from once routes are
 * configured server-side.
 */
export const BRIDGE_DESTINATIONS: readonly BridgeDestination[] = [
  { id: 'ethereum', label: 'Ethereum', surface: 'evm' },
  { id: 'base', label: 'Base', surface: 'evm' },
  { id: 'polygon', label: 'Polygon', surface: 'evm' },
  { id: 'arbitrum', label: 'Arbitrum', surface: 'evm' },
  { id: 'optimism', label: 'Optimism', surface: 'evm' },
  { id: 'bnb', label: 'BNB Chain', surface: 'evm' },
  { id: 'solana', label: 'Solana', surface: 'svm' },
];

export type SendRoute =
  | {
      kind: 'tenzro';
      recipient: string;
      /** Sub-steps the orchestrator will run, in order. */
      steps: readonly RouteStep[];
    }
  | {
      kind: 'bridge';
      recipient: string;
      /** EVM addresses are ambiguous between many chains — user must pick. */
      candidates: readonly BridgeDestination[];
      /** Either pre-selected (e.g. SVM → 'solana') or `null` until the user picks. */
      selected: BridgeDestination | null;
      steps: readonly RouteStep[];
    }
  | { kind: 'invalid'; reason: string };

export type RouteStep =
  | { op: 'transfer'; description: string }
  | { op: 'crossVm'; from: TenzroVm; to: TenzroVm; description: string }
  | { op: 'bridge'; destChain: string; description: string };

export interface PlanInput {
  readonly recipient: string;
  /** Optional: when balances are known, the orchestrator can pre-flight wrap/cross-VM steps. */
  readonly balances?: TokenBalances | undefined;
  /** For EVM destinations, the chain the user picked from `candidates`. */
  readonly forcedDestChain?: string | undefined;
}

/**
 * Plan a send. Pure function — no RPCs. The UI calls this on every
 * keystroke to decide what controls to surface.
 */
export function planSend(input: PlanInput): SendRoute {
  const detected = detectAddress(input.recipient);

  switch (detected.kind) {
    case 'unknown':
      return { kind: 'invalid', reason: detected.reason };

    case 'tenzro':
      return {
        kind: 'tenzro',
        recipient: detected.address,
        steps: [
          {
            op: 'transfer',
            description: 'Sign on Tenzro testnet (server-side MPC)',
          },
        ],
      };

    case 'evm':
    case 'svm':
      return planBridge(detected, input.forcedDestChain);
  }
}

function planBridge(
  detected: Extract<AddressKind, { kind: 'evm' | 'svm' }>,
  forcedDestChain: string | undefined,
): SendRoute {
  // SVM is unambiguous — only Solana uses base58 Ed25519 pubkeys here.
  if (detected.kind === 'svm') {
    const sol = BRIDGE_DESTINATIONS.find((d) => d.id === 'solana');
    if (!sol) {
      throw new Error('BRIDGE_DESTINATIONS is missing the "solana" entry — internal config error');
    }
    return {
      kind: 'bridge',
      recipient: detected.address,
      candidates: [sol],
      selected: sol,
      steps: [
        {
          op: 'bridge',
          destChain: 'solana',
          description: 'Bridge to Solana via LayerZero V2',
        },
      ],
    };
  }

  // EVM: address shape is shared across many chains, user must pick.
  const evmDests = BRIDGE_DESTINATIONS.filter((d) => d.surface === 'evm');
  const selected = forcedDestChain
    ? (evmDests.find((d) => d.id === forcedDestChain) ?? null)
    : null;

  return {
    kind: 'bridge',
    recipient: detected.address,
    candidates: evmDests,
    selected,
    steps: selected
      ? [
          {
            op: 'bridge',
            destChain: selected.id,
            description: `Bridge to ${selected.label} via LayerZero V2`,
          },
        ]
      : [],
  };
}
