/**
 * NanopaymentFlow — wallet-side orchestration helpers for nanopayment
 * channels. The `NanopaymentPort` exposes the SDK's primitives one-for-one;
 * this module composes them into the lifecycle a real consumer (LLM
 * streaming UI, per-API-call paywall, bandwidth meter) actually drives:
 *
 *   open → many sendNanopayment → autoFlush at threshold → close on done
 *
 * The orchestration is all wallet-side. The node holds the channel state,
 * the SDK exposes RPCs, this module sequences them.
 */

import type {
  NanoChannel,
  NanopaymentPort,
  NanopaymentReceipt,
} from '../ports/agent/nanopayment.ts';

export interface NanopaymentSessionOptions {
  /** Auto-flush after this many off-chain payments accumulate. */
  readonly flushEvery?: number;
  /** Auto-flush when accumulated value crosses this threshold (smallest units). */
  readonly flushAtAmount?: bigint;
  /** Hard cap on total session spend. Throws if exceeded. */
  readonly sessionCap?: bigint;
}

const DEFAULT_OPTS: Required<Omit<NanopaymentSessionOptions, 'sessionCap'>> = {
  flushEvery: 100,
  flushAtAmount: 0n, // disabled by default — count-only
};

/**
 * Stateful helper that owns one open channel. Counts payments + value, flushes
 * on threshold, closes on `done()`. Designed to be created once at the start
 * of a streaming session and discarded at the end.
 */
export class NanopaymentSession {
  readonly #port: NanopaymentPort;
  readonly #channel: NanoChannel;
  readonly #opts: NanopaymentSessionOptions;
  #unsettledCount = 0;
  #unsettledAmount = 0n;
  #totalPaid = 0n;
  #closed = false;

  private constructor(
    port: NanopaymentPort,
    channel: NanoChannel,
    opts: NanopaymentSessionOptions,
  ) {
    this.#port = port;
    this.#channel = channel;
    this.#opts = opts;
  }

  /** Open a channel and return a session bound to it. */
  static async open(
    port: NanopaymentPort,
    req: { payer: string; payee: string; deposit: bigint; asset?: string },
    opts: NanopaymentSessionOptions = {},
  ): Promise<NanopaymentSession> {
    const channel = await port.openChannel({
      payer: req.payer,
      payee: req.payee,
      deposit: req.deposit,
      ...(req.asset !== undefined ? { asset: req.asset } : {}),
    });
    return new NanopaymentSession(port, channel, opts);
  }

  get channelId(): string {
    return this.#channel.channelId;
  }

  get totalPaid(): bigint {
    return this.#totalPaid;
  }

  /**
   * Send a single off-chain payment. Returns the receipt. Auto-flushes
   * when count or amount thresholds cross.
   */
  async send(amount: bigint, memo?: string): Promise<NanopaymentReceipt> {
    if (this.#closed) {
      throw new Error('NanopaymentSession.send: session is closed');
    }
    const cap = this.#opts.sessionCap;
    if (cap !== undefined && this.#totalPaid + amount > cap) {
      throw new Error(
        `NanopaymentSession.send: amount ${amount} would exceed session cap ${cap} ` +
          `(already paid ${this.#totalPaid})`,
      );
    }
    const receipt = await this.#port.sendNanopayment({
      channelId: this.#channel.channelId,
      amount,
      ...(memo !== undefined ? { memo } : {}),
    });
    this.#unsettledCount += 1;
    this.#unsettledAmount += amount;
    this.#totalPaid += amount;
    if (this.#shouldAutoFlush()) {
      await this.flush();
    }
    return receipt;
  }

  /** Force an on-chain batch settlement. Resets unsettled counters. */
  async flush(): Promise<void> {
    if (this.#unsettledCount === 0) return;
    await this.#port.flushBatch(this.#channel.channelId);
    this.#unsettledCount = 0;
    this.#unsettledAmount = 0n;
  }

  /** Close the channel. Idempotent; subsequent sends throw. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#unsettledCount > 0) {
      // Best-effort flush before close; if it fails, close still proceeds —
      // the node settles anything outstanding from the channel state.
      try {
        await this.#port.flushBatch(this.#channel.channelId);
      } catch {
        // swallow — close handles final state
      }
    }
    await this.#port.closeChannel(this.#channel.channelId);
  }

  #shouldAutoFlush(): boolean {
    const flushEvery = this.#opts.flushEvery ?? DEFAULT_OPTS.flushEvery;
    if (flushEvery > 0 && this.#unsettledCount >= flushEvery) return true;
    const flushAtAmount = this.#opts.flushAtAmount ?? DEFAULT_OPTS.flushAtAmount;
    if (flushAtAmount > 0n && this.#unsettledAmount >= flushAtAmount) return true;
    return false;
  }
}
