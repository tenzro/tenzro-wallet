/**
 * Erc8004SdkAdapter — wraps the SDK's `Erc8004Client`.
 *
 * Pure shape mapping: the SDK already returns hex calldata; we just rename
 * snake_case → camelCase. The wallet kernel takes the produced calldata
 * and signs+broadcasts it through the existing `evm-on-tenzro` surface.
 */

import type { Erc8004Client } from 'tenzro-sdk';
import type {
  Erc8004Agent,
  Erc8004AgentIdHex,
  Erc8004Calldata,
  Erc8004DerivedAgentId,
  Erc8004Port,
} from '../erc8004.ts';

/** Just the slice of `Erc8004Client` the adapter touches. */
export interface Erc8004ClientLike {
  deriveAgentId(
    owner: string,
    salt: string,
  ): Promise<{ agent_id: string; owner: string; salt: string }>;
  encodeRegister(
    agentId: string,
    registrationDataUri: string,
    owner: string,
  ): Promise<{ selector: string; calldata: string }>;
  encodeGetAgent(agentId: string): Promise<{ selector: string; calldata: string }>;
  decodeGetAgent(returndata: string): Promise<{
    registration_data_uri: string;
    owner: string;
  }>;
  encodeFeedback(
    agentId: string,
    score: number,
    feedbackAuthId: string,
    feedbackUri: string,
  ): Promise<{ selector: string; calldata: string }>;
  encodeRequestValidation(
    agentId: string,
    validatorId: string,
    requestUri: string,
    dataHash: string,
  ): Promise<{ selector: string; calldata: string }>;
  encodeSubmitValidation(
    dataHash: string,
    response: number,
    responseUri: string,
    tag: string,
  ): Promise<{ selector: string; calldata: string }>;
}

function mapCalldata(raw: { selector: string; calldata: string }): Erc8004Calldata {
  return {
    selector: raw.selector as `0x${string}`,
    calldata: raw.calldata as `0x${string}`,
  };
}

export class Erc8004SdkAdapter implements Erc8004Port {
  constructor(private readonly client: Erc8004ClientLike) {}

  static fromClient(client: Erc8004Client): Erc8004SdkAdapter {
    return new Erc8004SdkAdapter(client as unknown as Erc8004ClientLike);
  }

  async deriveAgentId(
    owner: `0x${string}`,
    salt: `0x${string}`,
  ): Promise<Erc8004DerivedAgentId> {
    const raw = await this.client.deriveAgentId(owner, salt);
    return {
      agentId: raw.agent_id as Erc8004AgentIdHex,
      owner: raw.owner as `0x${string}`,
      salt: raw.salt as `0x${string}`,
    };
  }

  async encodeRegister(
    agentId: Erc8004AgentIdHex,
    registrationDataUri: string,
    owner: `0x${string}`,
  ): Promise<Erc8004Calldata> {
    return mapCalldata(
      await this.client.encodeRegister(agentId, registrationDataUri, owner),
    );
  }

  async encodeGetAgent(agentId: Erc8004AgentIdHex): Promise<Erc8004Calldata> {
    return mapCalldata(await this.client.encodeGetAgent(agentId));
  }

  async decodeGetAgent(returndata: `0x${string}`): Promise<Erc8004Agent> {
    const raw = await this.client.decodeGetAgent(returndata);
    return {
      registrationDataUri: raw.registration_data_uri,
      owner: raw.owner as `0x${string}`,
    };
  }

  async encodeFeedback(
    agentId: Erc8004AgentIdHex,
    score: number,
    feedbackAuthId: string,
    feedbackUri: string,
  ): Promise<Erc8004Calldata> {
    return mapCalldata(
      await this.client.encodeFeedback(agentId, score, feedbackAuthId, feedbackUri),
    );
  }

  async encodeRequestValidation(
    agentId: Erc8004AgentIdHex,
    validatorId: string,
    requestUri: string,
    dataHash: `0x${string}`,
  ): Promise<Erc8004Calldata> {
    return mapCalldata(
      await this.client.encodeRequestValidation(
        agentId,
        validatorId,
        requestUri,
        dataHash,
      ),
    );
  }

  async encodeSubmitValidation(
    dataHash: `0x${string}`,
    response: number,
    responseUri: string,
    tag: string,
  ): Promise<Erc8004Calldata> {
    return mapCalldata(
      await this.client.encodeSubmitValidation(dataHash, response, responseUri, tag),
    );
  }
}
