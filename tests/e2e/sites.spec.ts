import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';

import { addAuthenticator } from './authenticator';
import { createAccount } from './helpers';

/** A site on another origin asks the wallet to connect through the popup protocol. */
test('a site connects through the wallet popup', async ({ page, context }, info) => {
  await addAuthenticator(context, page);
  const account = await createAccount(page);
  const site = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>site</title><button id=go>go</button><pre id=out></pre><script>
      document.getElementById('go').onclick = () => {
        const w = window.open('http://localhost:4173/approve', 'w', 'width=420,height=640');
        addEventListener('message', (e) => {
          if (e.data?.protocol !== 'tenzro-wallet/popup/v1') return;
          if (e.data.type === 'ready') w.postMessage({ protocol: 'tenzro-wallet/popup/v1', type: 'request', id: 1, method: 'tenzro_connect', params: [] }, '*');
          if (e.data.type === 'response') document.getElementById('out').textContent = JSON.stringify(e.data);
        });
      };
    </script>`);
  });
  await new Promise<void>((r) => site.listen(4174, '127.0.0.1', r));
  try {
    const host = await context.newPage();
    await host.goto('http://localhost:4174/');
    const popup = context.waitForEvent('page');
    await host.click('#go');
    const wallet = await popup;
    await wallet.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(host.locator('#out')).toContainText(account.slice(0, 20), { timeout: 30_000 });
    await host.screenshot({ path: info.outputPath('site-connected.png') });
  } finally {
    site.close();
  }
});
