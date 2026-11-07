import { expect, test } from '@playwright/test';

import { addAuthenticator, watch } from './authenticator';
import { createAccount, finishSetup, fundAccount, linkDevice, newDevice } from './helpers';

test('links a second device with an invite and a request code; it waits before it counts', async ({
  page,
  context,
  browser,
}, info) => {
  // QUARANTINED when WALLET_E2E_FUND is unset: this spec funds an address on the dev node, and the node has no faucet. It needs WALLET_E2E_FUND (command taking <address> <TNZO>, see README) pointing at a funded solo node on the launch genesis. It runs unchanged and asserts the same as before once that is set.
  test.skip(
    !process.env.WALLET_E2E_FUND,
    'needs WALLET_E2E_FUND (funding command for a dev node with no faucet); see README e2e section',
  );
  const seen = watch(page);
  await addAuthenticator(context, page);
  const account = await createAccount(page);
  await fundAccount(page, account, '25');
  await finishSetup(page);
  const b = await newDevice(browser);
  const code = await linkDevice(page, b.page);
  // The same request again is stale (the account's keystore moved on): once approved,
  // the nodes simulate it as failing and Send stays disabled. A valid request (above)
  // had it enabled.
  await page.goto('/requests');
  await page.getByPlaceholder('tzk1...').fill(code);
  await page.getByRole('button', { name: 'Read request' }).click();
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect(page.getByText(/Would fail/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Send the approved change' })).toBeDisabled();
  await page.goto('/devices');
  // The keystore reaches chain state a block or two after the send.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/Counts as a root in/)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [3_000] });
  await page.screenshot({ path: info.outputPath('devices-a.png') });
  await b.page.getByRole('button', { name: 'It is approved' }).click();
  // The wallet reloads on /devices once the keystore links this passkey.
  await expect(b.page.getByText('This device', { exact: true })).toBeVisible({ timeout: 60_000 });
  await b.page.screenshot({ path: info.outputPath('devices-b.png') });
  // Sign-in from the account now resolves: the keystore is on chain.
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out on this device' }).click();
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page.getByText('Receive')).toBeVisible({ timeout: 60_000 });
  expect(seen.errors).toEqual([]);
});
