/**
 * Kernel-level test for the agent ports bundle. Pins:
 *   (a) `kernel.agent.<port>()` returns the configured port,
 *   (b) accessing an unconfigured port throws a clear error.
 */

import { describe, expect, it } from 'vitest';
import { testIdentity } from './identity/test-identity.ts';
import { WalletKernel } from './kernel.ts';
import type { AgentPaymentPort } from './ports/agent/index.ts';
import type { SurfaceModule } from './types/surface-module.ts';
import type { SurfaceName } from './types/surface.ts';

function stubAgentPayment(): AgentPaymentPort {
  return {
    getDailySpend: async (agentDid) => ({
      agentDid,
      spentToday: 10n,
      dailyLimit: 100n,
      remaining: 90n,
    }),
    updateAgentTerms: async (req) => ({
      agentDid: req.agentDid,
      delegation: req.terms,
      tokensRevoked: 0,
    }),
  };
}

const noSurfaces: ReadonlyMap<SurfaceName, SurfaceModule> = new Map();

describe('WalletKernel agent-ports bundle', () => {
  it('exposes configured ports through `kernel.agent.<port>()`', async () => {
    const identity = await testIdentity({ uuid: 'kernel-agent-1' });
    const kernel = new WalletKernel({
      identity,
      surfaces: noSurfaces,
      agentPorts: { agentPayment: stubAgentPayment() },
    });
    const spend = await kernel.agent.agentPayment().getDailySpend('did:tenzro:agent');
    expect(spend?.remaining).toBe(90n);
  });

  it('throws a clear error when a port is not configured', async () => {
    const identity = await testIdentity({ uuid: 'kernel-agent-2' });
    const kernel = new WalletKernel({
      identity,
      surfaces: noSurfaces,
      agentPorts: { agentPayment: stubAgentPayment() },
    });
    expect(() => kernel.agent.escrow()).toThrow(/agent port "escrow" not configured/);
    expect(kernel.agent.agentPayment()).toBeTruthy();
  });

  it('accessing any agent port throws when agentPorts is omitted entirely', async () => {
    const identity = await testIdentity({ uuid: 'kernel-agent-3' });
    const kernel = new WalletKernel({ identity, surfaces: noSurfaces });
    expect(() => kernel.agent.agentPayment()).toThrow(/agent port "agentPayment" not configured/);
  });

  it('htlcEscrow accessor mirrors the agent-port pattern', async () => {
    const identity = await testIdentity({ uuid: 'kernel-agent-htlc' });
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
});
