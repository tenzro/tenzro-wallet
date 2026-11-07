import { expect, test } from '@playwright/test';

import { RPC, RPC2, addAuthenticator, watch } from './authenticator';
import { createAccount, fundAccount } from './helpers';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

test.describe('error and edge states', () => {
  test('the network is down', async ({ page }, info) => {
    // both routes of the build are down
    for (const url of [RPC, RPC2])
      await page.route(url, (route) => route.abort('connectionrefused'));
    await page.goto('/');
    await expect(page.getByText(/No node answers|Failed|fetch|network/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('button', { name: 'Create with a passkey' })).toBeDisabled();
    await page.screenshot({ path: info.outputPath('network-down.png') });
  });

  test('a node that answers for another chain is refused', async ({ page }, info) => {
    const answerWrongChain = async (route: import('@playwright/test').Route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: CORS });
      }
      const body = JSON.parse(route.request().postData() ?? '{}') as { id?: number };
      return route.fulfill({
        status: 200,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 1, result: '0x539' }),
      });
    };
    for (const url of [RPC, RPC2]) await page.route(url, answerWrongChain);
    await page.goto('/');
    await expect(page.getByText(/No node answers for chain 13380/)).toBeVisible({
      timeout: 60_000,
    });
    await page.screenshot({ path: info.outputPath('wrong-chain.png') });
  });

  test('a passkey prompt that is refused ends with a readable message', async ({
    page,
    context,
  }, info) => {
    const auth = await addAuthenticator(context, page);
    await auth.setUserVerified(false);
    await page.goto('/');
    await page.getByPlaceholder('Alex').fill('Refused');
    const create = page.getByRole('button', { name: 'Create with a passkey' });
    await expect(create).toBeEnabled({ timeout: 30_000 });
    await create.click();
    await expect(page.getByText('The passkey prompt was closed.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Receive')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('passkey-refused.png') });
  });

  test('an authenticator without the PRF extension cannot make an account, and says so', async ({
    page,
    context,
  }, info) => {
    await addAuthenticator(context, page, { hasPrf: false });
    await page.goto('/');
    await page.getByPlaceholder('Alex').fill('NoPrf');
    const create = page.getByRole('button', { name: 'Create with a passkey' });
    await expect(create).toBeEnabled({ timeout: 30_000 });
    await create.click();
    await expect(page.getByText(/cannot make an account here/)).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: info.outputPath('no-prf.png') });
  });

  test('a site is told to open the wallet first when nobody is signed in', async ({
    page,
  }, info) => {
    await page.goto('/approve');
    await expect(page.getByText(/opens from a site/)).toBeVisible();
    await page.screenshot({ path: info.outputPath('approve-direct.png') });
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });

  test('signed out and signed in at phone width', async ({ page, context }, info) => {
    // QUARANTINED when WALLET_E2E_FUND is unset: this spec funds an address on the dev node, and the node has no faucet. It needs WALLET_E2E_FUND (command taking <address> <TNZO>, see README) pointing at a funded solo node on the launch genesis. It runs unchanged and asserts the same as before once that is set.
    test.skip(
      !process.env.WALLET_E2E_FUND,
      'needs WALLET_E2E_FUND (funding command for a dev node with no faucet); see README e2e section',
    );
    const seen = watch(page);
    await addAuthenticator(context, page);
    await page.goto('/');
    await page.screenshot({ path: info.outputPath('mobile-welcome.png') });
    const account = await createAccount(page, 'Phone');
    await fundAccount(page, account, '3');
    await page.screenshot({ path: info.outputPath('mobile-account.png') });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    expect(seen.errors).toEqual([]);
  });
});
