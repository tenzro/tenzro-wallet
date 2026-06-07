/**
 * BabylonPort — Babylon Bitcoin staking finality-providers protocol.
 *
 * Tenzro validators can opt into being economically secured by native
 * BTC delegations through Babylon. Bitcoin holders delegate to a
 * Tenzro validator (registered as a Babylon finality provider), and
 * the validator must submit Extractable One-Time Signatures (EOTS)
 * over Tenzro block hashes to avoid slashing of the delegated BTC.
 *
 * Wallet usage: read-side surface for staking dashboards (list
 * providers, sum BTC delegations, list delegations for a provider).
 * Write paths (`registerFinalityProvider`, `submitFinalitySignature`)
 * are validator-operational and not user-facing in a typical wallet,
 * but the port exposes them so a validator-operator host can use the
 * wallet kernel as the signing surface.
 */

export interface RegisterFinalityProviderRequest {
  readonly validator: string;
  /** 33-byte BTC public key (0x-prefixed hex). */
  readonly btc_pk: string;
  readonly commission_bps: number;
}

export interface FinalityProvider {
  readonly validator: string;
  readonly btc_pk: string;
  readonly commission_bps: number;
  readonly active: boolean;
}

export interface BabylonTotalStake {
  readonly validator: string;
  readonly total_satoshis: number;
  readonly delegation_count: number;
}

export interface SubmitFinalitySignatureRequest {
  readonly validator: string;
  readonly block_hash: string;
  /** EOTS signature over the block hash (0x-prefixed hex). */
  readonly eots_signature: string;
}

export interface BtcDelegation {
  readonly delegator_btc_pk: string;
  readonly validator: string;
  readonly satoshis: number;
  readonly start_height: number;
  readonly end_height?: number | null;
}

export interface BabylonPort {
  registerFinalityProvider(
    req: RegisterFinalityProviderRequest,
  ): Promise<FinalityProvider>;
  getFinalityProvider(validator: string): Promise<FinalityProvider | null>;
  listFinalityProviders(): Promise<FinalityProvider[]>;
  totalStakeForProvider(validator: string): Promise<BabylonTotalStake>;
  submitFinalitySignature(req: SubmitFinalitySignatureRequest): Promise<unknown>;
  listDelegations(validator: string): Promise<BtcDelegation[]>;
}
