/**
 * Every wait in the keystore is a governed network parameter. The wallet
 * reads the current values from chain state and never assumes one.
 */

import { GovernanceClient, type RpcClient } from 'tenzro-sdk';

export const WAIT_KEYS = {
  addDevice: 'keystore.add_device_wait_ms',
  recoveryKeyAndEmail: 'keystore.recovery_wait_key_and_email_ms',
  recoveryKey: 'keystore.recovery_wait_key_ms',
  recoveryOther: 'keystore.recovery_wait_other_ms',
  codeRevealDelay: 'keystore.recovery_code_reveal_delay_ms',
  codeClaimTtl: 'keystore.recovery_code_claim_ttl_ms',
  codeWait: 'keystore.recovery_code_wait_ms',
} as const;

export type Waits = { readonly [K in keyof typeof WAIT_KEYS]: number | null };

export async function readWaits(rpc: RpcClient): Promise<Waits> {
  const { params } = await new GovernanceClient(rpc).getNetworkParams();
  const value = (key: string) => {
    const p = params.find((x) => x.key === key);
    return p ? Number(p.value) : null;
  };
  return Object.fromEntries(
    Object.entries(WAIT_KEYS).map(([name, key]) => [name, value(key)]),
  ) as Waits;
}

/** A duration for people: "7 days", "48 hours", "1 hour", "5 minutes". */
export function duration(ms: number | null): string {
  if (ms === null) return 'a governed wait';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 72) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(ms / 86_400_000);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Time left until `atMs`, for a countdown. */
export function remaining(atMs: number, nowMs: number): string {
  const left = atMs - nowMs;
  return left <= 0 ? 'now' : `in ${duration(left)}`;
}
