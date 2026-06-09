/**
 * WormholeNttPort — Wormhole Native Token Transfers (NTT) registry.
 *
 * Wallet usage: surfaces the registered NTT chain catalog + supported
 * transceiver kinds (Wormhole / Axelar / LayerZero / custom) so the
 * user can see which destination chains an NTT-deployed token can
 * reach before they sign.
 */

export interface WormholeNttChain {
  readonly wormholeChainId: number;
  readonly name: string;
}

export interface WormholeNttCatalog {
  readonly chains: readonly WormholeNttChain[];
  readonly transceiverKinds: readonly string[];
  readonly scaffolding: boolean;
  readonly note?: string;
}

export interface WormholeNttPort {
  listChains(): Promise<WormholeNttCatalog>;
}
