/**
 * The nodes the wallet talks to. It starts from the configured seeds, reads
 * the network's RPC operators from consensus state, keeps the endpoints that
 * answer for the chain and agree on its history, and fails over between
 * them. A second node, run by another operator, re-derives what every
 * approval does.
 */

import { type CheckedEndpoint, FailoverTransport, RpcClient, discoverEndpoints } from 'tenzro-sdk';

import { CHAIN_ID, SECOND_RPC, SEEDS } from './config';

export interface Network {
  /** Calls fail over between every checked endpoint. */
  readonly rpc: RpcClient;
  /** A node of another operator, or null when the network lists none. */
  readonly second: RpcClient | null;
  readonly endpoints: readonly CheckedEndpoint[];
}

/** Picks an endpoint run by an operator other than the first endpoint's. */
export function pickSecond(endpoints: readonly CheckedEndpoint[]): CheckedEndpoint | null {
  const first = endpoints[0];
  if (!first) return null;
  return (
    endpoints.find(
      (e) => e.url !== first.url && e.account !== undefined && e.account !== first.account,
    ) ?? null
  );
}

export async function openNetwork(): Promise<Network> {
  const endpoints = await discoverEndpoints({ seeds: [...SEEDS], chainId: CHAIN_ID });
  if (endpoints.length === 0) {
    throw new Error(`No node answers for chain ${CHAIN_ID}.`);
  }
  const urls = endpoints.map((e) => e.url);
  const rpc = new RpcClient(urls[0] as string, undefined, 30_000, new FailoverTransport(urls));
  const secondUrl = SECOND_RPC ?? pickSecond(endpoints)?.url;
  const second = secondUrl ? new RpcClient(secondUrl) : null;
  return { rpc, second, endpoints };
}

let opened: Promise<Network> | null = null;

/** The wallet's network connection, opened once per page. */
export function network(): Promise<Network> {
  if (!opened) {
    opened = openNetwork().catch((err) => {
      opened = null;
      throw err;
    });
  }
  return opened;
}
