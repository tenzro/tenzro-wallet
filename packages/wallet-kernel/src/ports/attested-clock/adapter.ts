/**
 * AttestedClockAdapter — `AttestedClockPort` backed by `tenzro-sdk`
 * `AttestedClockClient`.
 */

import type { AttestedClockClient } from 'tenzro-sdk';
import type { AttestedClockPort, AttestedTimestamp } from './attested-clock.ts';

export type AttestedClockClientLike = Pick<AttestedClockClient, 'now'>;

export class AttestedClockAdapter implements AttestedClockPort {
  constructor(private readonly client: AttestedClockClientLike) {}

  async now(): Promise<AttestedTimestamp> {
    const r = await this.client.now();
    return {
      wallMs: r.wall_ms,
      monotonicNs: r.monotonic_ns,
      teeVendor: r.tee_vendor,
      ...(r.note !== undefined ? { note: r.note } : {}),
    };
  }
}
