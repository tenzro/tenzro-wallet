/**
 * AttestedClockPort — TEE-attested timestamp envelope.
 *
 * Wallet usage: long-running operations (saga step deadlines,
 * obligation expiries, AP2 mandate validity windows, parametric
 * insurance trigger windows, margin-call grace periods) need a
 * tamper-resistant timestamp. The wallet asks the node for an
 * attested-clock envelope, surfaces `wallMs` to the user, and binds
 * the envelope into the operation it's signing.
 */

export interface AttestedTimestamp {
  readonly wallMs: number;
  readonly monotonicNs: number;
  readonly teeVendor: string | null;
  readonly note?: string;
}

export interface AttestedClockPort {
  now(): Promise<AttestedTimestamp>;
}
