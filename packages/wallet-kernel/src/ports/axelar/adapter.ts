/**
 * AxelarAdapter — `AxelarPort` backed by `tenzro-sdk` `AxelarClient`.
 */

import type { AxelarClient } from 'tenzro-sdk';
import type {
  AxelarCallContractRequest,
  AxelarCallContractResult,
  AxelarChain,
  AxelarMessage,
  AxelarPayGasRequest,
  AxelarPayGasResult,
  AxelarPort,
} from './axelar.ts';

export type AxelarClientLike = Pick<
  AxelarClient,
  'listChains' | 'callContract' | 'payGas' | 'getMessage'
>;

export class AxelarAdapter implements AxelarPort {
  constructor(private readonly client: AxelarClientLike) {}

  listChains(): Promise<AxelarChain[]> {
    return this.client.listChains() as Promise<AxelarChain[]>;
  }
  callContract(req: AxelarCallContractRequest): Promise<AxelarCallContractResult> {
    return this.client.callContract(req as never) as Promise<AxelarCallContractResult>;
  }
  payGas(req: AxelarPayGasRequest): Promise<AxelarPayGasResult> {
    return this.client.payGas(req as never) as Promise<AxelarPayGasResult>;
  }
  getMessage(payloadHash: string): Promise<AxelarMessage | null> {
    return this.client.getMessage(payloadHash) as Promise<AxelarMessage | null>;
  }
}
