/**
 * Inpage — runs in the dApp's main world, mounts `window.tenzro` and
 * fires the EIP-6963 announce event.
 *
 * The kernel's `buildEip6963Announcement` helper would normally produce
 * the announcement object. We mirror its shape here so the inpage
 * remains tiny and avoids pulling the kernel into the page's bundle —
 * the actual provider methods are message-bridged to the background.
 */

import { defineUnlistedScript } from '#imports';

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
}

export default defineUnlistedScript(() => {
  const requestId = (() => {
    let n = 0;
    return () => `tenzro:${++n}`;
  })();

  const pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.target !== 'tenzro:inpage') return;
    const handler = pending.get(data.id);
    if (!handler) return;
    pending.delete(data.id);
    if (data.payload?.error) handler.reject(data.payload.error);
    else handler.resolve(data.payload?.result);
  });

  const provider: Eip1193Provider = {
    request({ method, params }) {
      return new Promise((resolve, reject) => {
        const id = requestId();
        pending.set(id, { resolve, reject });
        window.postMessage(
          { target: 'tenzro:bg', requestId: id, method, params: params ?? [] },
          window.location.origin,
        );
      });
    },
    on() {
      // event subscription stubs — wire when the background pushes events
    },
    removeListener() {},
  };

  // Mount at window.tenzro
  Object.defineProperty(window, 'tenzro', {
    value: provider,
    writable: false,
    configurable: false,
  });

  // EIP-6963 announce
  const announcement = {
    info: {
      uuid: crypto.randomUUID(),
      name: 'Tenzro Wallet',
      icon: `data:image/svg+xml;utf8,${encodeURIComponent(TENZRO_MARK_SVG)}`,
      rdns: 'network.tenzro.wallet',
    },
    provider,
  } as const;

  const fireAnnounce = () => {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: announcement }));
  };

  fireAnnounce();
  window.addEventListener('eip6963:requestProvider', fireAnnounce);
});

const TENZRO_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#7c3aed"/><path d="M8 9.5h16M16 10v13M11 14.5h10" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>`;
