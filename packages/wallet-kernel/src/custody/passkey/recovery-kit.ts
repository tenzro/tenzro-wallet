/**
 * The Recovery Kit: public data only (account, identity, and the signed record
 * of which keys may sign). It holds no key material, so losing or leaking it
 * costs nothing; it lets any node restore who may sign.
 */

const KIT_FORMAT = 'tenzro-recovery-kit';

/** The Recovery Kit: public data a person saves so any node can restore who may sign. */
export interface RecoveryKit {
  readonly format: typeof KIT_FORMAT;
  readonly version: 1;
  readonly createdAt: string;
  readonly network: string;
  readonly rpId: string;
  readonly account: string;
  readonly did: string;
  /** The signed account record, exactly as the node published it. */
  readonly record: unknown;
}

export function buildRecoveryKit(opts: {
  readonly account: string;
  readonly did: string;
  readonly rpId: string;
  readonly network: string;
  readonly record: unknown;
}): RecoveryKit {
  return {
    format: KIT_FORMAT,
    version: 1,
    createdAt: new Date().toISOString(),
    network: opts.network,
    rpId: opts.rpId,
    account: opts.account,
    did: opts.did,
    record: opts.record,
  };
}
