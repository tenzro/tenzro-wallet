/**
 * Mock data driving the UI demo.
 *
 * Chains are the user-facing taxonomy now (Ethereum, Base, Polygon,
 * Tempo, Optimism, Arbitrum, BNB, Solana, Canton, plus Tenzro's three
 * native chains). The kernel still classifies each chain to a surface
 * (native / evm / svm / canton) for routing, but the UI rows show the
 * chain name and chain logo.
 *
 * Per the project decimals: native + EVM = 18, SVM = 9, Canton CC = 10.
 */

import type { ChainId } from '@tenzro/ui';

export const SELF_DID =
  'did:tenzro:0x7e4c2a9b3e2c91dfa3d5c8b1f4c9a78e5d6f2b8a3c7e9d4f1a5b6c8d2e3f4a5b';
export const SELF_LABEL = 'Hilary · Personal';

export interface Asset {
  symbol: string;
  name: string;
  chain: ChainId;
  baseUnits: string;
  usdValue: number;
  changePct: number;
}

export const ASSETS: Asset[] = [
  // WTNZO across the three Tenzro chains
  {
    symbol: 'WTNZO',
    name: 'Wrapped TNZO',
    chain: 'tenzro',
    baseUnits: '1247000000000000000000',
    usdValue: 12470,
    changePct: 4.21,
  },
  {
    symbol: 'WTNZO',
    name: 'Wrapped TNZO',
    chain: 'tenzro-evm',
    baseUnits: '350000000000000000000',
    usdValue: 3500,
    changePct: 4.21,
  },
  {
    symbol: 'WTNZO',
    name: 'Wrapped TNZO',
    chain: 'tenzro-svm',
    baseUnits: '180000000000',
    usdValue: 1800,
    changePct: 4.21,
  },

  // Stablecoins on real EVM chains
  {
    symbol: 'USDC',
    name: 'USD Coin',
    chain: 'base',
    baseUnits: '8420410000000000000000',
    usdValue: 8420.41,
    changePct: 0.01,
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    chain: 'tempo',
    baseUnits: '4200000000000000000000',
    usdValue: 4200,
    changePct: 0.0,
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    chain: 'arbitrum',
    baseUnits: '1850000000000000000000',
    usdValue: 1850,
    changePct: 0.0,
  },

  // Other tokens
  {
    symbol: 'ETH',
    name: 'Ether',
    chain: 'ethereum',
    baseUnits: '420000000000000000',
    usdValue: 1428,
    changePct: 1.84,
  },
  {
    symbol: 'ETH',
    name: 'Ether',
    chain: 'base',
    baseUnits: '180000000000000000',
    usdValue: 612,
    changePct: 1.84,
  },
  {
    symbol: 'OP',
    name: 'Optimism',
    chain: 'optimism',
    baseUnits: '120000000000000000000',
    usdValue: 312,
    changePct: -0.42,
  },
  {
    symbol: 'POL',
    name: 'Polygon',
    chain: 'polygon',
    baseUnits: '450000000000000000000',
    usdValue: 245,
    changePct: -1.12,
  },
  {
    symbol: 'BNB',
    name: 'BNB',
    chain: 'bnb',
    baseUnits: '1500000000000000000',
    usdValue: 880,
    changePct: 0.62,
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    chain: 'solana',
    baseUnits: '8500000000',
    usdValue: 1240,
    changePct: 2.94,
  },
  {
    symbol: 'JTO',
    name: 'Jito',
    chain: 'solana',
    baseUnits: '12500000000',
    usdValue: 312,
    changePct: -2.14,
  },

  // Canton
  {
    symbol: 'CC',
    name: 'Canton Coin',
    chain: 'canton',
    baseUnits: '52000000000000',
    usdValue: 5200,
    changePct: -0.84,
  },
];

export const TOTAL_USD = ASSETS.reduce((s, a) => s + a.usdValue, 0);

export interface Activity {
  id: string;
  kind: 'send' | 'receive' | 'swap' | 'agent' | 'cross-vm' | 'bridge';
  chain: ChainId;
  toChain?: ChainId;
  counterparty?: string;
  amount: string;
  symbol: string;
  state: 'finalized' | 'mempool' | 'included' | 'failed';
  ts: number;
  agentName?: string;
  vendor?: string;
}

const NOW = Date.now();

export const ACTIVITY: Activity[] = [
  {
    id: 'a1',
    kind: 'cross-vm',
    chain: 'tenzro-evm',
    toChain: 'tenzro-svm',
    amount: '12.4 WTNZO',
    symbol: 'WTNZO',
    state: 'finalized',
    ts: NOW - 1_200_000,
  },
  {
    id: 'a2',
    kind: 'agent',
    chain: 'base',
    counterparty: 'shopify.merchant.eth',
    amount: '$12.40',
    symbol: 'USDC',
    state: 'finalized',
    ts: NOW - 4_400_000,
    agentName: 'Doorstep · Groceries',
  },
  {
    id: 'a3',
    kind: 'receive',
    chain: 'canton',
    counterparty: 'BlackRock · Custody',
    amount: '5,000.0 CC',
    symbol: 'CC',
    state: 'finalized',
    ts: NOW - 7_200_000,
  },
  {
    id: 'a4',
    kind: 'send',
    chain: 'tenzro',
    counterparty: 'tnz1qz0…8m',
    amount: '85.0 WTNZO',
    symbol: 'WTNZO',
    state: 'finalized',
    ts: NOW - 86_400_000,
  },
  {
    id: 'a5',
    kind: 'agent',
    chain: 'tempo',
    counterparty: 'aws.invoice.tempo',
    amount: '$220.00',
    symbol: 'USDC',
    state: 'mempool',
    ts: NOW - 120_000,
    agentName: 'Compute Spot · Replenishment',
  },
  {
    id: 'a6',
    kind: 'bridge',
    chain: 'ethereum',
    toChain: 'tenzro-evm',
    amount: '0.5 ETH',
    symbol: 'ETH',
    state: 'included',
    ts: NOW - 720_000,
    vendor: 'Wormhole',
  },
];

export interface AgentMandate {
  id: string;
  kind: 'intent' | 'cart' | 'payment' | 'session-key';
  agentName: string;
  agentDid: string;
  agentVerifier?: string;
  summary: string;
  cap?: { amount: string; currency: string; window?: string };
  recipientClass?: string;
  expiresAt: number;
  chain: ChainId;
  state: 'pending' | 'active' | 'revoked' | 'expired';
  reputation?: { score: number; reviews: number };
  attestationId?: string;
}

export const MANDATES: AgentMandate[] = [
  {
    id: 'm1',
    kind: 'intent',
    agentName: 'Doorstep · Groceries',
    agentDid: 'did:erc8004:agent:doorstep.commerce.eth',
    agentVerifier: 'erc8004.commerce',
    summary:
      'Buy groceries from approved Doorstep merchants when my pantry sensor reports milk under 25%.',
    cap: { amount: '$25', currency: 'USDC', window: 'day' },
    recipientClass: 'doorstep:approved-merchants',
    expiresAt: NOW + 30 * 86_400_000,
    chain: 'base',
    state: 'pending',
    reputation: { score: 4.92, reviews: 1284 },
    attestationId: 'tee:0x91…3a',
  },
  {
    id: 'm2',
    kind: 'session-key',
    agentName: 'Compute Spot · Replenishment',
    agentDid: 'did:erc8004:agent:compute-spot.cloud.eth',
    agentVerifier: 'erc8004.aws',
    summary: 'Pay AWS Spot rebates monthly into my reimbursement wallet, signed via x402 on Tempo.',
    cap: { amount: '$500', currency: 'USDC', window: 'month' },
    recipientClass: 'aws.invoice.*',
    expiresAt: NOW + 60 * 86_400_000,
    chain: 'tempo',
    state: 'active',
    reputation: { score: 4.71, reviews: 312 },
    attestationId: 'tee:0xa3…f8',
  },
  {
    id: 'm3',
    kind: 'cart',
    agentName: 'Trip Wallet',
    agentDid: 'did:erc8004:agent:trip.wallet.eth',
    agentVerifier: 'erc8004.travel',
    summary: 'Pay $342 for Lufthansa LH401 (FRA → JFK) on 2026-05-14 — confirmation pending.',
    cap: { amount: '$342', currency: 'USDC' },
    recipientClass: 'lufthansa.iata',
    expiresAt: NOW + 600_000,
    chain: 'base',
    state: 'pending',
    reputation: { score: 4.88, reviews: 8124 },
    attestationId: 'tee:0xb1…2e',
  },
  {
    id: 'm4',
    kind: 'session-key',
    agentName: 'Yield Pilot',
    agentDid: 'did:erc8004:agent:yield-pilot.defi.eth',
    summary:
      'Rebalance my Solana yield positions weekly into protocols above 8% APY (max 10% slippage).',
    cap: { amount: '500 SOL', currency: 'SOL', window: 'week' },
    recipientClass: 'solana:yield-protocols',
    expiresAt: NOW + 14 * 86_400_000,
    chain: 'solana',
    state: 'active',
    reputation: { score: 4.55, reviews: 2241 },
  },
];

export interface DAppConnection {
  id: string;
  origin: string;
  name: string;
  caip25Scope: string;
  chains: ChainId[];
  connectedAt: number;
}

export const DAPPS: DAppConnection[] = [
  {
    id: 'd1',
    origin: 'https://uniswap.org',
    name: 'Uniswap',
    caip25Scope: 'eip155:1,eip155:8453,eip155:42161',
    chains: ['ethereum', 'base', 'arbitrum'],
    connectedAt: NOW - 86_400_000 * 3,
  },
  {
    id: 'd2',
    origin: 'https://jupiter.ag',
    name: 'Jupiter',
    caip25Scope: 'svm:tenzro,svm:solana',
    chains: ['tenzro-svm', 'solana'],
    connectedAt: NOW - 86_400_000,
  },
  {
    id: 'd3',
    origin: 'https://dops.tenzro.xyz',
    name: 'Tenzro DOPS',
    caip25Scope: 'tenzro:native,eip155:tenzro,svm:tenzro',
    chains: ['tenzro', 'tenzro-evm', 'tenzro-svm'],
    connectedAt: NOW - 86_400_000 * 7,
  },
  {
    id: 'd4',
    origin: 'https://app.tempo.xyz',
    name: 'Tempo',
    caip25Scope: 'eip155:tempo',
    chains: ['tempo'],
    connectedAt: NOW - 86_400_000 * 2,
  },
];

export interface CantonHolding {
  party: string;
  amount: string;
  symbol: string;
  validator: string;
  custodian?: string;
}

export const CANTON_HOLDINGS: CantonHolding[] = [
  {
    party: 'tenzro::wallet::hilary',
    amount: '5,200.0',
    symbol: 'CC',
    validator: 'splice.tenzro.global',
  },
  {
    party: 'tenzro::wallet::hilary',
    amount: '2.5',
    symbol: 'BTC.canton',
    validator: 'splice.tenzro.global',
    custodian: 'Anchorage',
  },
];
