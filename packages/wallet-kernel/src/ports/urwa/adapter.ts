/**
 * UrwaAdapter — `UrwaPort` backed by `tenzro-sdk` `UrwaClient`.
 */

import type { UrwaClient } from 'tenzro-sdk';
import type {
  SetFrozenTokensRequest,
  UrwaFrozenAmount,
  UrwaFrozenRecord,
  UrwaKillSwitchCleared,
  UrwaKillSwitchState,
  UrwaKillSwitchTriggered,
  UrwaKillSwitchTriggerRequest,
  UrwaPort,
} from './urwa.ts';

export type UrwaClientLike = Pick<
  UrwaClient,
  | 'isKillSwitched'
  | 'getFrozenTokens'
  | 'setFrozenTokens'
  | 'triggerKillSwitch'
  | 'clearKillSwitch'
>;

export class UrwaAdapter implements UrwaPort {
  constructor(private readonly client: UrwaClientLike) {}

  async isKillSwitched(tokenIdHex: string): Promise<UrwaKillSwitchState> {
    const r = await this.client.isKillSwitched(tokenIdHex);
    return {
      tokenIdHex: r.token_id_hex,
      active: r.active,
      selectors: r.selectors,
      precompileAddresses: r.precompile_addresses,
    };
  }

  async getFrozenTokens(
    tokenIdHex: string,
    accountHex: string,
  ): Promise<UrwaFrozenAmount> {
    const r = await this.client.getFrozenTokens(tokenIdHex, accountHex);
    return {
      tokenIdHex: r.token_id_hex,
      accountHex: r.account_hex,
      frozenAmount: r.frozen_amount,
    };
  }

  async setFrozenTokens(req: SetFrozenTokensRequest): Promise<UrwaFrozenRecord> {
    const r = await this.client.setFrozenTokens({
      token_id_hex: req.tokenIdHex,
      account_hex: req.accountHex,
      amount: req.amount,
      ...(req.reason !== undefined ? { reason: req.reason } : {}),
    });
    return {
      tokenIdHex: r.token_id_hex,
      accountHex: r.account_hex,
      amount: r.amount,
      reason: r.reason,
      setAtMs: r.set_at_ms,
    };
  }

  async triggerKillSwitch(
    req: UrwaKillSwitchTriggerRequest,
  ): Promise<UrwaKillSwitchTriggered> {
    const r = await this.client.triggerKillSwitch({
      token_id_hex: req.tokenIdHex,
      ...(req.triggeredByDid !== undefined ? { triggered_by_did: req.triggeredByDid } : {}),
      ...(req.reason !== undefined ? { reason: req.reason } : {}),
    });
    return {
      tokenIdHex: r.token_id_hex,
      active: r.active,
      triggeredByDid: r.triggered_by_did,
      reason: r.reason,
      triggeredAtMs: r.triggered_at_ms,
    };
  }

  async clearKillSwitch(tokenIdHex: string): Promise<UrwaKillSwitchCleared> {
    const r = await this.client.clearKillSwitch(tokenIdHex);
    return {
      tokenIdHex: r.token_id_hex,
      active: r.active,
    };
  }
}
