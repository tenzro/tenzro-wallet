/**
 * Kernel-level test for the agent-payment ports bundle. Pins:
 *   (a) `kernel.agent.<port>()` returns the configured port,
 *   (b) accessing an unconfigured port throws a clear error,
 *   (c) the kernel doesn't accidentally hold references between unrelated ports.
 */

import { describe, expect, it } from 'vitest';
import { provisionIdentity } from './identity/provision.ts';
import { WalletKernel } from './kernel.ts';
import type {
  AgentPaymentPort,
  Ap2Port,
  Erc8004Port,
  NanopaymentPort,
} from './ports/agent/index.ts';
import type { SurfaceModule } from './types/surface-module.ts';
import type { SurfaceName } from './types/surface.ts';

function stubAp2(): Ap2Port {
  return {
    verifyMandate: async () => ({ valid: true, mandateType: 'Intent' }),
    validateMandatePair: async () => ({ valid: true, delegationEnforced: false }),
    createSession: async () => ({
      sessionId: 's-1',
      agentDid: 'did:tenzro:agent',
      providerDid: 'did:tenzro:p',
      service: 'inference',
      maxAmount: 1n,
      totalSpent: 0n,
      asset: 'TNZO',
      status: 'active',
    }),
    authorizePayment: async (sid, amount) => ({
      authorizationId: 'a-1',
      sessionId: sid,
      amount,
      status: 'approved',
    }),
    executePayment: async (sid) => ({
      receiptId: 'r-1',
      sessionId: sid,
      amount: 1n,
      asset: 'TNZO',
    }),
    cancelSession: async (sid) => ({ sessionId: sid, status: 'cancelled' }),
    getSession: async () => null,
    listAgentSessions: async () => [],
  };
}

function stubErc8004(): Erc8004Port {
  return {
    deriveAgentId: async (owner, salt) => ({
      agentId: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
      owner,
      salt,
    }),
    encodeRegister: async () => ({
      selector: '0x12345678',
      calldata: '0x12345678',
    }),
    encodeGetAgent: async () => ({ selector: '0x', calldata: '0x' }),
    decodeGetAgent: async () => ({
      registrationDataUri: 'ipfs://Qm',
      owner: ('0x' + '11'.repeat(20)) as `0x${string}`,
    }),
    encodeFeedback: async () => ({ selector: '0x', calldata: '0x' }),
    encodeRequestValidation: async () => ({ selector: '0x', calldata: '0x' }),
    encodeSubmitValidation: async () => ({ selector: '0x', calldata: '0x' }),
  };
}

function stubAgentPayment(): AgentPaymentPort {
  return {
    setSpendingPolicy: async (req) => ({ agentDid: req.agentDid, status: 'ok' }),
    getSpendingPolicy: async () => null,
    payForService: async (req) => ({
      receiptId: 'r-1',
      agentDid: req.agentDid,
      provider: req.provider,
      amount: req.amount,
      serviceType: req.serviceType,
      txHash: '0xabc',
    }),
    getDailySpend: async (agentDid) => ({
      agentDid,
      totalSpent: 0n,
      dailyLimit: 1n,
      remaining: 1n,
      transactionCount: 0,
    }),
    listAgentTransactions: async () => [],
  };
}

function stubNanopayment(): NanopaymentPort {
  return {
    openChannel: async (req) => ({
      channelId: 'ch-1',
      payer: req.payer,
      payee: req.payee,
      deposit: req.deposit,
      balance: req.deposit,
      totalPaid: 0n,
      asset: req.asset ?? 'TNZO',
      paymentCount: 0,
      status: 'open',
    }),
    sendNanopayment: async (req) => ({
      paymentId: 'p-1',
      channelId: req.channelId,
      amount: req.amount,
      sequence: 1,
    }),
    flushBatch: async (channelId) => ({
      channelId,
      paymentCount: 0,
      totalAmount: 0n,
      txHash: '0x',
      status: 'settled',
    }),
    closeChannel: async (channelId) => ({
      channelId,
      finalAmount: 0n,
      refunded: 0n,
      txHash: '0x',
      status: 'closed',
    }),
    getChannel: async () => null,
    listChannels: async () => [],
  };
}

const noSurfaces: ReadonlyMap<SurfaceName, SurfaceModule> = new Map();

describe('WalletKernel agent-ports bundle', () => {
  it('exposes configured ports through `kernel.agent.<port>()`', async () => {
    const identity = await provisionIdentity({ uuid: 'kernel-agent-1' });
    const kernel = new WalletKernel({
      identity,
      surfaces: noSurfaces,
      agentPorts: {
        ap2: stubAp2(),
        erc8004: stubErc8004(),
        agentPayment: stubAgentPayment(),
        nanopayment: stubNanopayment(),
      },
    });

    const v = await kernel.agent.ap2().verifyMandate({});
    expect(v.valid).toBe(true);

    const derived = await kernel.agent
      .erc8004()
      .deriveAgentId(
        ('0x' + '11'.repeat(20)) as `0x${string}`,
        ('0x' + '22'.repeat(32)) as `0x${string}`,
      );
    expect(derived.agentId.startsWith('0x')).toBe(true);

    const receipt = await kernel.agent.agentPayment().payForService({
      agentDid: 'did:tenzro:agent',
      provider: '0xprovider',
      amount: 1_000n,
      serviceType: 'inference',
    });
    expect(receipt.txHash).toBe('0xabc');

    const channel = await kernel.agent.nanopayment().openChannel({
      payer: '0xa',
      payee: '0xb',
      deposit: 1_000n,
    });
    expect(channel.status).toBe('open');
  });

  it('throws a clear error when a port is not configured', async () => {
    const identity = await provisionIdentity({ uuid: 'kernel-agent-2' });
    const kernel = new WalletKernel({
      identity,
      surfaces: noSurfaces,
      // Only ap2 wired; the other three should throw on access.
      agentPorts: { ap2: stubAp2() },
    });

    expect(() => kernel.agent.erc8004()).toThrow(/agent port "erc8004" not configured/);
    expect(() => kernel.agent.agentPayment()).toThrow(/agent port "agentPayment" not configured/);
    expect(() => kernel.agent.nanopayment()).toThrow(/agent port "nanopayment" not configured/);
    // ap2 still works.
    expect(kernel.agent.ap2()).toBeTruthy();
  });

  it('accessing any agent port throws when agentPorts is omitted entirely', async () => {
    const identity = await provisionIdentity({ uuid: 'kernel-agent-3' });
    const kernel = new WalletKernel({ identity, surfaces: noSurfaces });
    expect(() => kernel.agent.ap2()).toThrow(/agent port "ap2" not configured/);
  });

  it('htlcEscrow accessor mirrors the agent-port pattern', async () => {
    const identity = await provisionIdentity({ uuid: 'kernel-agent-htlc' });
    const stubHtlc = {
      lock: async () => ({ htlcId: 'h1', txHash: '0x', status: 'locked' as const }),
      redeem: async () => ({ txHash: '0xredeem' }),
      refund: async () => ({ txHash: '0xrefund' }),
      get: async () => null,
    };
    const wired = new WalletKernel({
      identity,
      surfaces: noSurfaces,
      agentPorts: { htlcEscrow: stubHtlc },
    });
    expect(wired.agent.htlcEscrow()).toBe(stubHtlc);

    const unwired = new WalletKernel({ identity, surfaces: noSurfaces });
    expect(() => unwired.agent.htlcEscrow()).toThrow(/agent port "htlcEscrow" not configured/);
  });

  it('erc7802 accessor mirrors the agent-port pattern', async () => {
    const identity = await provisionIdentity({ uuid: 'kernel-agent-erc7802' });
    const stubErc7802 = {
      crosschainMint: async () => ({
        txHash: '0xmint',
        token: '0xabc',
        recipient: '0xdef',
        amount: '1000',
        sourceChain: 'optimism',
        status: 'finalized',
      }),
      crosschainBurn: async () => ({
        txHash: '0xburn',
        token: '0xabc',
        from: '0xfee',
        amount: '1000',
        targetChain: 'tenzro',
        status: 'finalized',
      }),
      getCrossChainSupply: async () => ({
        token: '0xabc',
        totalSupply: '1000',
        chainSupplies: { tenzro: '1000' },
      }),
    };
    const wired = new WalletKernel({
      identity,
      surfaces: noSurfaces,
      agentPorts: { erc7802: stubErc7802 },
    });
    expect(wired.agent.erc7802()).toBe(stubErc7802);

    const unwired = new WalletKernel({ identity, surfaces: noSurfaces });
    expect(() => unwired.agent.erc7802()).toThrow(/agent port "erc7802" not configured/);
  });

  it('bridge.adapters() returns registered adapters; bridge.get() looks up by id', async () => {
    const identity = await provisionIdentity({ uuid: 'kernel-bridge-1' });
    const stub = (id: 'lifi' | 'ccip' | 'layerzero') => ({
      adapterId: id,
      quote: async () => {
        throw new Error('test');
      },
      build: async () => {
        throw new Error('test');
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      track: async function* () {
        throw new Error('test');
      },
    });
    const lifi = stub('lifi');
    const ccip = stub('ccip');
    const kernel = new WalletKernel({
      identity,
      surfaces: noSurfaces,
      bridgeAdapters: [lifi, ccip],
    });
    expect(kernel.bridge.adapters()).toHaveLength(2);
    expect(kernel.bridge.get('lifi')).toBe(lifi);
    expect(kernel.bridge.get('ccip')).toBe(ccip);
    expect(kernel.bridge.get('layerzero')).toBeUndefined();
  });

  it('bridge.adapters() defaults to empty when none registered', async () => {
    const identity = await provisionIdentity({ uuid: 'kernel-bridge-2' });
    const kernel = new WalletKernel({ identity, surfaces: noSurfaces });
    expect(kernel.bridge.adapters()).toEqual([]);
  });
});
