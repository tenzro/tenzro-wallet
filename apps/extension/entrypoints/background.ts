/**
 * Background service worker — the wallet's privileged dispatch surface.
 *
 * Responsibilities (MV3):
 *   - Receive port messages from inpage scripts (relayed by the content
 *     script) and route EIP-1193 / SVM / Canton / Tenzro RPC calls
 *   - Open the popup or side-panel for user-confirmation flows
 *     (signature requests, mandate approvals)
 *   - Keep DPoP-bound JWTs fresh (M2 model — replaced by passkey-quorum
 *     once the /wallet/* endpoints land)
 *   - Manage session-key TTL via chrome.alarms
 *
 * In this scaffold we wire the message router skeleton — the kernel
 * methods are stubbed so the extension can be loaded and tested.
 */

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
async function dispatch(method: string, params: unknown[] = []): Promise<unknown> {
  switch (method) {
    case 'tenzro_walletInfo':
      return {
        version: '0.0.0',
        surfaces: ['native', 'evm', 'svm', 'canton'],
        rpc: 'https://rpc.tenzro.xyz',
      };
    case 'eth_chainId':
      return '0x7a69'; // Tenzro EVM testnet placeholder
    case 'eth_accounts':
      return ['0x7e4c2a9b3e2c91dfa3d5c8b1f4c9a78e5d6f2b8a3'];
    case 'eth_requestAccounts':
      // Real impl: open popup, await user consent, return the connected account
      return ['0x7e4c2a9b3e2c91dfa3d5c8b1f4c9a78e5d6f2b8a3'];
    default:
      throw new Error(`Method ${method} not implemented`);
  }
}
