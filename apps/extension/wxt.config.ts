import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

/**
 * WXT config — Tenzro Wallet browser extension (MV3, cross-browser).
 *
 * Manifest:
 *   - host_permissions <all_urls> needed so the inpage content script
 *     can announce via EIP-6963 on every dApp the user visits
 *   - storage + alarms for session-key TTL bookkeeping
 *   - sidePanel for the persistent activity feed
 *   - notifications for finalized tx + agentic mandate prompts
 *
 * `@wxt-dev/module-react` adds React Fast Refresh + JSX handling for
 * popup, sidepanel, and options pages.
 */
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Tenzro Wallet',
    short_name: 'Tenzro',
    description:
      'One identity, every surface. The official wallet for Tenzro Ledger — native, EVM, SVM, Canton.',
    permissions: ['storage', 'alarms', 'notifications', 'sidePanel', 'tabs'],
    host_permissions: ['<all_urls>'],
    side_panel: {
      default_path: 'sidepanel.html',
    },
    action: {
      default_title: 'Tenzro Wallet',
      default_popup: 'popup.html',
    },
    web_accessible_resources: [
      {
        resources: ['inpage.js'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
