/**
 * Background service worker — the wallet's privileged dispatch surface.
 *
 * Responsibilities (MV3):
 *   - Receive port messages from inpage scripts (relayed by the content
 *     script) and route EIP-1193 / SVM / Canton / Tenzro RPC calls
 *   - Open the popup or side-panel for user-confirmation flows
 *     (signature requests, mandate approvals)
 *   - Route approvals to the passkey ceremony (the wallet never holds keys)
 *   - Manage session-key TTL via chrome.alarms
 *
 * In this scaffold we wire the message router skeleton — the kernel
 * methods are stubbed so the extension can be loaded and tested.
 */

import { BOOTSTRAP_RPC_URLS, NETWORK_1_CHAIN_ID, NetworkTransport } from 'tenzro-wallet/custody';
import { defineBackground } from '#imports';

export default defineBackground(() => {
  console.log('Tenzro Wallet background worker started');

  // Side-panel open on action click (MV3 pattern)
  if (chrome.sidePanel) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: false })
      .catch((err) => console.warn('sidePanel.setPanelBehavior failed', err));
  }

  // Long-lived port for content scripts
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'tenzro-content') return;

    port.onMessage.addListener(async (msg: unknown) => {
      // msg shape: { id, method, params }
      const m = msg as { id: number; method: string; params?: unknown[] };

      try {
        const result = await dispatch(m.method, m.params);
        port.postMessage({ id: m.id, result });
      } catch (err) {
        port.postMessage({
          id: m.id,
          error: { code: -32603, message: (err as Error).message },
        });
      }
    });
  });

  // Mandate / session-key expiry housekeeping
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name.startsWith('mandate-expire:')) {
      const id = alarm.name.split(':')[1];
      console.log('Mandate expired', id);
      // Real impl: kernel.consent.revoke(id), notify, propagate to peers
    }
  });
});

/**
 * Dispatch — the central method router.
 *
 * Eventually this is where the kernel's `KernelEip1193Provider` and
 * the SVM/Canton equivalents are mounted. For now it returns sensible
 * stubs so the inpage script can verify the message bus is alive.
 */
/**
 * The network's endpoints: found from its staked RPC operators, starting
 * from a bootstrap hint, each checked against Tenzro Network 1's chain id,
 * with failover between the ones that answer.
 */
const network = new NetworkTransport({
  bootstrap: BOOTSTRAP_RPC_URLS,
  chainId: NETWORK_1_CHAIN_ID,
});

function nodeCall(method: string, params: unknown[]): Promise<unknown> {
  return network.call(method, params);
}

async function dispatch(method: string, params: unknown[] = []): Promise<unknown> {
  switch (method) {
    // Wallet-local info (never sent to the node).
    case 'tenzro_walletInfo':
      return {
        version: '0.3.0',
        network: 'Tenzro Network 1',
        surfaces: ['native', 'evm', 'svm', 'canton'],
        rpc: network.endpoints()[0] ?? null,
      };
    // Chain id is always read from the node.
    case 'eth_chainId':
    case 'eth_blockNumber':
      return nodeCall(method, params);
    // No account is exposed until the user connects with a passkey in the popup.
    case 'eth_accounts':
    case 'eth_requestAccounts':
      return [];
    default:
      throw new Error(`Method ${method} not implemented`);
  }
}
