/**
 * BabylonAdapter — `BabylonPort` backed by `tenzro-sdk` `BabylonClient`.
 */

import type { BabylonClient } from 'tenzro-sdk';
import type {
  BabylonPort,
  BabylonTotalStake,
  BtcDelegation,
  FinalityProvider,
  RegisterFinalityProviderRequest,
  SubmitFinalitySignatureRequest,
} from './babylon.ts';

export type BabylonClientLike = Pick<
  BabylonClient,
  | 'registerFinalityProvider'
  | 'getFinalityProvider'
  | 'listFinalityProviders'
  | 'totalStakeForProvider'
  | 'submitFinalitySignature'
  | 'listDelegations'
>;

export class BabylonAdapter implements BabylonPort {
  constructor(private readonly client: BabylonClientLike) {}

  registerFinalityProvider(
    req: RegisterFinalityProviderRequest,
  ): Promise<FinalityProvider> {
    return this.client.registerFinalityProvider(req as never) as Promise<FinalityProvider>;
  }
  getFinalityProvider(validator: string): Promise<FinalityProvider | null> {
    return this.client.getFinalityProvider(validator) as Promise<FinalityProvider | null>;
  }
  listFinalityProviders(): Promise<FinalityProvider[]> {
    return this.client.listFinalityProviders() as Promise<FinalityProvider[]>;
  }
  totalStakeForProvider(validator: string): Promise<BabylonTotalStake> {
    return this.client.totalStakeForProvider(validator) as Promise<BabylonTotalStake>;
  }
  submitFinalitySignature(req: SubmitFinalitySignatureRequest): Promise<unknown> {
    return this.client.submitFinalitySignature(req as never);
  }
  listDelegations(validator: string): Promise<BtcDelegation[]> {
    return this.client.listDelegations(validator) as Promise<BtcDelegation[]>;
  }
}
