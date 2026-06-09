/**
 * UrwaPort — ERC-7943 (uRWA) compliance surface for tokenized RWAs.
 *
 * Wallet usage: surfaces compliance status (kill-switch active,
 * frozen-tokens record) to the user before they sign any transfer
 * of an affected asset. Mutations are admin-token-gated at the
 * node layer.
 */

export interface UrwaKillSwitchState {
  readonly tokenIdHex: string;
  readonly active: boolean;
  readonly selectors: Readonly<Record<string, string>>;
  readonly precompileAddresses: Readonly<Record<string, string>>;
}

export interface UrwaFrozenAmount {
  readonly tokenIdHex: string;
  readonly accountHex: string;
  readonly frozenAmount: string;
}

export interface SetFrozenTokensRequest {
  readonly tokenIdHex: string;
  readonly accountHex: string;
  readonly amount: string;
  readonly reason?: string;
}

export interface UrwaFrozenRecord {
  readonly tokenIdHex: string;
  readonly accountHex: string;
  readonly amount: string;
  readonly reason: string | null;
  readonly setAtMs: number;
}

export interface UrwaKillSwitchTriggerRequest {
  readonly tokenIdHex: string;
  readonly triggeredByDid?: string;
  readonly reason?: string;
}

export interface UrwaKillSwitchTriggered {
  readonly tokenIdHex: string;
  readonly active: boolean;
  readonly triggeredByDid: string | null;
  readonly reason: string | null;
  readonly triggeredAtMs: number;
}

export interface UrwaKillSwitchCleared {
  readonly tokenIdHex: string;
  readonly active: boolean;
}

export interface UrwaPort {
  /** Read: surface kill-switch + frozen state to the signing UI. */
  isKillSwitched(tokenIdHex: string): Promise<UrwaKillSwitchState>;
  getFrozenTokens(tokenIdHex: string, accountHex: string): Promise<UrwaFrozenAmount>;
  /** Admin-token-gated mutations. */
  setFrozenTokens(req: SetFrozenTokensRequest): Promise<UrwaFrozenRecord>;
  triggerKillSwitch(req: UrwaKillSwitchTriggerRequest): Promise<UrwaKillSwitchTriggered>;
  clearKillSwitch(tokenIdHex: string): Promise<UrwaKillSwitchCleared>;
}
