import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';

import { addAuthenticator } from './authenticator';
import { createAccount, finishSetup, fundAccount } from './helpers';

/** A site on another origin asks the wallet to connect through the popup protocol. */
test('a site connects through the wallet popup', async ({ page, context }, info) => {
  // QUARANTINED when WALLET_E2E_FUND is unset: this spec funds an address on the dev node, and the node has no faucet. It needs WALLET_E2E_FUND (command taking <address> <TNZO>, see README) pointing at a funded solo node on the launch genesis. It runs unchanged and asserts the same as before once that is set.
  test.skip(
    !process.env.WALLET_E2E_FUND,
    'needs WALLET_E2E_FUND (funding command for a dev node with no faucet); see README e2e section',
  );
  await addAuthenticator(context, page);
  const account = await createAccount(page);
  await fundAccount(page, account, '25');
  await finishSetup(page);
  const site = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>site</title><button id=go>go</button><pre id=out></pre><script>
      document.getElementById('go').onclick = () => {
        const w = window.open('http://localhost:4173/approve', 'w', 'width=420,height=640');
        addEventListener('message', (e) => {
          if (e.data?.protocol !== 'tenzro-wallet/popup/v1') return;
          if (e.data.type === 'ready') w.postMessage({ protocol: 'tenzro-wallet/popup/v1', type: 'request', id: '1', method: 'tenzro_connect', params: [] }, '*');
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
    const connect = wallet.getByRole('button', { name: 'Connect', exact: true });
    await connect.waitFor({ timeout: 30_000 }).catch(async () => {
      throw new Error(`popup shows: ${await wallet.locator('body').innerText()}`);
    });
    await connect.click();
    await expect(host.locator('#out')).toContainText(account.slice(0, 20), { timeout: 30_000 });
    await host.screenshot({ path: info.outputPath('site-connected.png') });
  } finally {
    site.close();
  }
});
