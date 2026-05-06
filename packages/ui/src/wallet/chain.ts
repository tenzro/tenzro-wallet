/**
 * Chain registry — the canonical UI taxonomy.
 *
 * Two layers of taxonomy live in this wallet:
 *
 *   1. SURFACE (kernel concept, in tokens/index): one of four execution
 *      surfaces — native, evm, svm, canton. The kernel router dispatches
 *      based on this. Users never see the word "surface" in the UI.
 *
 *   2. CHAIN (this file, UI concept): the concrete network the user
 *      cares about — Ethereum, Base, Polygon, Tempo, Optimism, Arbitrum,
 *      BNB, Solana, Canton MainNet, plus Tenzro's three native chains
 *      (tenzro for the native VM, tenzro-evm and tenzro-svm for the
 *      Tenzro-hosted EVM and SVM chains).
 *
 * Each chain knows its dispatch surface, so the router still works on
 * the four-surface model — but the UI shows chain identity (logo + name)
 * on every asset row, every tx, every dApp connection.
 *
 * Routes between chains:
 *   - same Tenzro internal chain pair → POINTER-OP (precompile 0x1003)
 *   - Tenzro-internal ↔ external (Ethereum, Base, …, Canton) → BRIDGE
 *   - external ↔ external (e.g. Ethereum ↔ Base) → BRIDGE (vendor-attributed)
 *
 * Logos are inline SVG path data. They render in the chain's `color`
 * — never use a different fill. This keeps brand identity recognizable
 * without splashing color across the surrounding chrome.
 */

import type { SurfaceKind } from '../tokens';

export type ChainId =
  // Tenzro-internal
  | 'tenzro'
  | 'tenzro-evm'
  | 'tenzro-svm'
  // External EVM
  | 'ethereum'
  | 'base'
  | 'polygon'
  | 'tempo'
  | 'optimism'
  | 'arbitrum'
  | 'bnb'
  // External SVM
  | 'solana'
  // External institutional
  | 'canton';

export interface ChainMeta {
  id: ChainId;
  name: string;
  shortName: string;
  surface: SurfaceKind;
  /** Tenzro-internal chains route via pointer-op between each other; external chains require a bridge */
  isInternal: boolean;
  /** Brand color in OKLCH, used ONLY on the logo glyph — never on UI chrome */
  color: string;
  /** SVG inner content, viewBox 0 0 24 24, no fills (we apply currentColor) */
  logo: string;
  /** Optional secondary descriptor, e.g. "Tenzro · native" */
  subtitle?: string;
}

const T_MARK = `<rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor"/><path d="M7 8h10M12 8v9M9 12.5h6" stroke="oklch(0.99 0 0)" stroke-width="1.6" stroke-linecap="round"/>`;

export const CHAINS: Record<ChainId, ChainMeta> = {
  /* ── Tenzro-internal chains ──────────────────────────────────── */
  tenzro: {
    id: 'tenzro',
    name: 'Tenzro',
    shortName: 'TNZ',
    surface: 'native',
    isInternal: true,
    color: 'oklch(0.78 0.14 195)',
    logo: T_MARK,
    subtitle: 'Native VM',
  },
  'tenzro-evm': {
    id: 'tenzro-evm',
    name: 'Tenzro EVM',
    shortName: 'TNZ·EVM',
    surface: 'evm',
    isInternal: true,
    color: 'oklch(0.7 0.18 285)',
    logo: T_MARK,
    subtitle: 'EVM on Tenzro',
  },
  'tenzro-svm': {
    id: 'tenzro-svm',
    name: 'Tenzro SVM',
    shortName: 'TNZ·SVM',
    surface: 'svm',
    isInternal: true,
    color: 'oklch(0.78 0.18 165)',
    logo: T_MARK,
    subtitle: 'SVM on Tenzro',
  },

  /* ── External EVM chains ─────────────────────────────────────── */
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    shortName: 'ETH',
    surface: 'evm',
    isInternal: false,
    color: 'oklch(0.6 0.04 270)',
    logo: `<path d="M12 2 5.5 12.4 12 16l6.5-3.6L12 2zM5.5 13.6 12 17l6.5-3.4L12 22 5.5 13.6z" fill="currentColor"/>`,
  },
  base: {
    id: 'base',
    name: 'Base',
    shortName: 'BASE',
    surface: 'evm',
    isInternal: false,
    color: 'oklch(0.55 0.22 260)',
    logo: `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 19a7 7 0 1 1 0-14h.5v3.5h-.5a3.5 3.5 0 1 0 0 7h.5V19h-.5z" fill="oklch(0.99 0 0)"/>`,
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    shortName: 'POL',
    surface: 'evm',
    isInternal: false,
    color: 'oklch(0.55 0.22 290)',
    logo: `<path d="M16.5 8.7v6.6L12 17.6l-4.5-2.3v-1.8L12 11.2l3 1.5v-2.4L12 8.8 5 12.3v3.6L12 19.4l7-3.5V8.7L16.5 7.4 12 9.7 7.5 7.4 12 5l4.5 2.4v1.3z" fill="currentColor"/>`,
  },
  tempo: {
    id: 'tempo',
    name: 'Tempo',
    shortName: 'TMP',
    surface: 'evm',
    isInternal: false,
    color: 'oklch(0.62 0.2 295)',
    logo: `<rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor"/><path d="M6 9c2 3 4 3 6 0s4-3 6 0v6c-2-3-4-3-6 0s-4 3-6 0V9z" fill="oklch(0.99 0 0)"/>`,
    subtitle: 'Stripe · payments',
  },
  optimism: {
    id: 'optimism',
    name: 'Optimism',
    shortName: 'OP',
    surface: 'evm',
    isInternal: false,
    color: 'oklch(0.62 0.22 25)',
    logo: `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M9.2 14.5c-1.6 0-2.4-.7-2.4-1.9 0-.3 0-.5.1-.8.3-1.4.7-2.1 1.4-2.6.7-.4 1.4-.5 2.3-.5 1.6 0 2.4.7 2.4 1.9 0 .3 0 .5-.1.8-.3 1.4-.7 2.1-1.4 2.6-.7.4-1.4.5-2.3.5zm.2-1.4c.5 0 .9-.2 1.2-.5.3-.3.5-.7.6-1.3.1-.3.1-.6.1-.7 0-.5-.3-.8-.9-.8-.5 0-.9.2-1.2.5-.3.3-.5.7-.6 1.3-.1.3-.1.6-.1.7 0 .5.3.8.9.8zm5-3.5h2.4c1.4 0 2.1.6 2.1 1.6 0 .3 0 .5-.1.7-.3 1.2-1 1.7-2.4 1.7h-1.2l-.4 1.7h-1.4l1-5.7zm.7 2.7h1c.5 0 .8-.2.9-.7 0-.1.1-.3.1-.4 0-.3-.2-.5-.6-.5h-1l-.4 1.6z" fill="oklch(0.99 0 0)"/>`,
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum',
    shortName: 'ARB',
    surface: 'evm',
    isInternal: false,
    color: 'oklch(0.65 0.16 230)',
    logo: `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 4 5 18h2.5l1-2h7l1 2H19L12 4zm-2.5 10L12 9l2.5 5h-5z" fill="oklch(0.99 0 0)"/>`,
  },
  bnb: {
    id: 'bnb',
    name: 'BNB Chain',
    shortName: 'BNB',
    surface: 'evm',
    isInternal: false,
    color: 'oklch(0.78 0.16 85)',
    logo: `<path d="M12 2 6 8l1.4 1.4L12 4.8l4.6 4.6L18 8 12 2zM4 12l1.4 1.4L12 6.8l6.6 6.6L20 12l-2.4-2.4L12 4.4 4 12zm14 0L12 6l-6 6 1.4 1.4L12 8.8l4.6 4.6L18 12zm-9 5 1.4 1.4L12 16.8l1.6 1.6L15 17l-3-3-3 3z" fill="currentColor"/><path d="M12 22 6 16l1.4-1.4L12 19.2l4.6-4.6L18 16l-6 6z" fill="currentColor"/>`,
  },

  /* ── External SVM ────────────────────────────────────────────── */
  solana: {
    id: 'solana',
    name: 'Solana',
    shortName: 'SOL',
    surface: 'svm',
    isInternal: false,
    color: 'oklch(0.72 0.2 295)',
    logo: `<path d="M5 7.5l3-2h11l-3 2H5zm0 4l3-2h11l-3 2H5zm0 4l3-2h11l-3 2H5z" fill="currentColor"/>`,
  },

  /* ── External institutional ──────────────────────────────────── */
  canton: {
    id: 'canton',
    name: 'Canton',
    shortName: 'CC',
    surface: 'canton',
    isInternal: false,
    color: 'oklch(0.74 0.16 50)',
    logo: `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M16 8.5a4.5 4.5 0 1 0 0 7" stroke="oklch(0.99 0 0)" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    subtitle: 'Splice MainNet',
  },
};

/**
 * Decimals per chain — mirrors the per-surface convention
 * (native + EVM = 18, SVM = 9, Canton = 10) but exposes them at the chain
 * level so consumers can call into one switch instead of two.
 */
export function chainDecimals(chain: ChainId): 18 | 9 | 10 {
  const surface = CHAINS[chain].surface;
  if (surface === 'svm') return 9;
  if (surface === 'canton') return 10;
  return 18;
}

/**
 * Route classification.
 *
 *   - "direct"  — same chain (no route)
 *   - "pointer" — between two Tenzro-internal chains (precompile 0x1003)
 *   - "bridge"  — anything else (vendor required)
 */
export function classifyRoute(from: ChainId, to: ChainId): 'direct' | 'pointer' | 'bridge' {
  if (from === to) return 'direct';
  if (CHAINS[from].isInternal && CHAINS[to].isInternal) return 'pointer';
  return 'bridge';
}

/** Convenience for asserting we know about a chain at compile time */
export const ALL_CHAINS = Object.values(CHAINS);
