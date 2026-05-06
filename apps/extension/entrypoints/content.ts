/**
 * Content script — the bridge between inpage and background.
 *
 * Pattern:
 *   1. Inject `inpage.js` into the page early (document_start)
 *   2. Open a long-lived port to the background worker
 *   3. Relay window.postMessage → port.postMessage and back
 *
 * The inpage script is the script that actually mounts `window.tenzro`
 * + dispatches EIP-6963 announce events. Keeping it as a separate
 * compiled file (rather than a string injection) preserves stack
 * traces and lets the WXT dev server hot-reload it.
 */

import { defineContentScript, injectScript } from '#imports';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  async main() {
    await injectScript('/inpage.js', { keepInDom: true });

    const port = chrome.runtime.connect({ name: 'tenzro-content' });
    let nextId = 1;
    const pending = new Map<number, (msg: unknown) => void>();

    port.onMessage.addListener((msg: { id: number; result?: unknown; error?: unknown }) => {
      const handler = pending.get(msg.id);
      if (!handler) return;
      pending.delete(msg.id);
      handler(msg);
    });

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.target !== 'tenzro:bg') return;

      const id = nextId++;
      pending.set(id, (resp) => {
        window.postMessage(
          { target: 'tenzro:inpage', id: data.requestId, payload: resp },
          window.location.origin,
        );
      });
      port.postMessage({ id, method: data.method, params: data.params });
    });
  },
});
