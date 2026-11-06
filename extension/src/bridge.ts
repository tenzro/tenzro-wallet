/**
 * Hands a request to the wallet page. The extension never signs: a passkey
 * works only on the page of the relying party it was made for, because the
 * network checks the WebAuthn origin against that domain. This page opens the
 * wallet, sends one request over the popup protocol, and accepts an answer
 * only from that window and that exact origin.
 */
import { WALLET_ORIGIN, saveStored } from './shared';

const PROTOCOL = 'tenzro-wallet/popup/v1';

interface Request {
  readonly method: 'tenzro_connect' | 'tenzro_sendTransaction';
  readonly params?: unknown;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function ask(request: Request): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const win = window.open(
      `${WALLET_ORIGIN}/approve`,
      'tenzro-wallet',
      'popup,width=440,height=720',
    );
    if (!win) {
      reject(new Error('The browser blocked the wallet window.'));
      return;
    }
    let watch: ReturnType<typeof setInterval> | undefined;
    const done = () => {
      window.removeEventListener('message', onMessage);
      clearInterval(watch);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== win || e.origin !== WALLET_ORIGIN) return;
      const d = e.data as {
        protocol?: string;
        type?: string;
        id?: string;
        result?: unknown;
        error?: { message?: string };
      };
      if (d?.protocol !== PROTOCOL) return;
      if (d.type === 'ready') {
        win.postMessage(
          {
            protocol: PROTOCOL,
            type: 'request',
            id,
            method: request.method,
            params: request.params,
          },
          WALLET_ORIGIN,
        );
      } else if (d.type === 'response' && d.id === id) {
        done();
        win.close();
        if (d.error) reject(new Error(d.error.message ?? 'The wallet refused.'));
        else resolve(d.result);
      }
    };
    window.addEventListener('message', onMessage);
    watch = setInterval(() => {
      if (win.closed) {
        done();
        reject(new Error('The wallet window was closed.'));
      }
    }, 1000);
  });
}

async function main() {
  const { bridgeRequest } = await chrome.storage.session.get('bridgeRequest');
  const request = bridgeRequest as Request | undefined;
  const button = $('continue') as HTMLButtonElement;
  const status = $('status');
  if (!request) {
    status.textContent = 'Nothing to approve. Close this tab and start again from the extension.';
    button.hidden = true;
    return;
  }
  $('what').textContent =
    request.method === 'tenzro_connect'
      ? 'Connect your wallet'
      : 'Approve a payment in your wallet';
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Waiting for your wallet...';
    try {
      const result = await ask(request);
      await chrome.storage.session.remove('bridgeRequest');
      if (request.method === 'tenzro_connect') {
        const r = result as { account: string; did: string };
        await saveStored({ account: r.account, did: r.did });
        status.textContent = 'Connected. You can close this tab.';
      } else {
        const r = result as { tx_hash?: string };
        await chrome.storage.session.set({ lastPayment: r.tx_hash ?? '' });
        status.textContent = `Sent. ${r.tx_hash ?? ''}`;
      }
      button.hidden = true;
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : String(e);
      button.disabled = false;
    }
  });
}

void main();
