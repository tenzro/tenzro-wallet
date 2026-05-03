/**
 * Erc7802SdkAdapter — wraps `tenzro-sdk@0.1.0` `Erc7802Client` so the
 * wallet can drive SuperchainERC20 cross-chain mint/burn operations.
 *
 * SDK shape (verified):
 *   crosschainMint(token, recipient, amount, sourceChain) → MintResult
 *   crosschainBurn(token, from, amount, targetChain)       → BurnResult
 *   getCrossChainSupply(token)                             → CrossChainSupply
 *
 * The SDK performs the operation atomically via
 * `tenzro_signAndSendTransaction`; the wallet does not need to drive a
 * `prepare → sign → submit` lifecycle. Snake-case wire fields are mapped
 * to camelCase at the adapter boundary.
 */

import type { Erc7802Client } from 'tenzro-sdk';
import type {
  CrosschainBurnRequest,
  CrosschainMintRequest,
  Erc7802BurnResult,
  Erc7802MintResult,
  Erc7802Port,
  Erc7802SupplyBreakdown,
} from '../erc7802.ts';

/**
 * Structural type the adapter accepts. The real adapter accepts the SDK
 * class directly; tests inject a fake. `Partial<>` allows pre-launch
 * SDK rollouts where one method is shipped ahead of another.
 */
export type Erc7802ClientLike = Partial<
  Pick<Erc7802Client, 'crosschainMint' | 'crosschainBurn' | 'getCrossChainSupply'>
>;

export class Erc7802SdkAdapter implements Erc7802Port {
  constructor(private readonly client: Erc7802ClientLike) {}

  async crosschainMint(req: CrosschainMintRequest): Promise<Erc7802MintResult> {
    if (!this.client.crosschainMint) {
      throw new Error(
        'Erc7802SdkAdapter.crosschainMint: SDK pending — tenzro-sdk Erc7802Client.crosschainMint not yet shipped',
      );
    }
    const raw = await this.client.crosschainMint(
      req.token,
      req.recipient,
      req.amount,
      req.sourceChain,
    );
    return {
      txHash: raw.tx_hash,
      token: raw.token,
      recipient: raw.recipient,
      amount: raw.amount,
      sourceChain: raw.source_chain,
      status: raw.status,
    };
  }

  async crosschainBurn(req: CrosschainBurnRequest): Promise<Erc7802BurnResult> {
    if (!this.client.crosschainBurn) {
      throw new Error(
        'Erc7802SdkAdapter.crosschainBurn: SDK pending — tenzro-sdk Erc7802Client.crosschainBurn not yet shipped',
      );
    }
    const raw = await this.client.crosschainBurn(
      req.token,
      req.from,
      req.amount,
      req.targetChain,
    );
    return {
      txHash: raw.tx_hash,
      token: raw.token,
      from: raw.from,
      amount: raw.amount,
      targetChain: raw.target_chain,
      status: raw.status,
    };
  }

  async getCrossChainSupply(token: string): Promise<Erc7802SupplyBreakdown> {
    if (!this.client.getCrossChainSupply) {
      throw new Error(
        'Erc7802SdkAdapter.getCrossChainSupply: SDK pending — tenzro-sdk Erc7802Client.getCrossChainSupply not yet shipped',
      );
    }
    const raw = await this.client.getCrossChainSupply(token);
    return {
      token: raw.token,
      totalSupply: raw.total_supply,
      chainSupplies: raw.chain_supplies,
    };
  }
}
