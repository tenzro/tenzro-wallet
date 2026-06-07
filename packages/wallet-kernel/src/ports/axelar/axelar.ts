/**
 * AxelarPort — Axelar GMP (General Message Passing) reach.
 *
 * Coverage: Cosmos (Osmosis, Cosmos Hub, Juno, Neutron, Injective,
 * Kujira, Crescent, Evmos), Move (Aptos, Sui), Stellar, XRPL,
 * Hyperliquid, Filecoin EVM, Kava, EVM mainline chains, and Tenzro.
 *
 * Wallet usage: an 8th vendor on the cross-chain route picker, used
 * specifically when the destination is non-EVM. The wallet asks for a
 * call-contract dispatch, optionally prepays gas, and tracks by payload
 * hash (correlation id is `keccak256(payload)`).
 */

export interface AxelarChain {
  readonly chain_id: string;
  readonly family: string;
  readonly gateway?: string;
  readonly gas_service?: string;
}

export interface AxelarCallContractRequest {
  readonly source_chain: string;
  readonly destination_chain: string;
  readonly destination_address: string;
  readonly payload_hex: string;
  readonly gas_token?: string;
  readonly gas_amount?: string;
}

export interface AxelarCallContractResult {
  readonly payload_hash: string;
  readonly source_chain: string;
  readonly destination_chain: string;
}

export interface AxelarPayGasRequest {
  readonly payload_hash: string;
  readonly source_chain: string;
  readonly destination_chain: string;
  readonly destination_address: string;
  readonly gas_token: string;
  readonly gas_amount: string;
}

export interface AxelarPayGasResult {
  readonly paid: boolean;
  readonly gas_token: string;
  readonly gas_amount: string;
}

export interface AxelarMessage {
  readonly payload_hash: string;
  readonly source_chain: string;
  readonly destination_chain: string;
  readonly destination_address: string;
  readonly status: string;
}

export interface AxelarPort {
  listChains(): Promise<AxelarChain[]>;
  callContract(req: AxelarCallContractRequest): Promise<AxelarCallContractResult>;
  payGas(req: AxelarPayGasRequest): Promise<AxelarPayGasResult>;
  getMessage(payloadHash: string): Promise<AxelarMessage | null>;
}
