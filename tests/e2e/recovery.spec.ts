import { expect, test } from '@playwright/test';

import { addAuthenticator, watch } from './authenticator';
import { createAccount, finishSetup, fundAccount } from './helpers';

test('turns the one-time recovery code on; the account then resolves from its passkey', async ({
  page,
  context,
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
  await page.goto('/recovery');
  await page.getByRole('button', { name: 'Turn on', exact: true }).click();
  await expect(page.getByText('Save the code kit now')).toBeVisible();
  const code = await page.locator('textarea').first().inputValue();
  expect(code).toMatch(/^[0-9a-f]{64}$/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download code kit' }).click();
  await download;
  await page.screenshot({ path: info.outputPath('recovery-kit.png') });
  await page.getByRole('button', { name: 'Turn on the code' }).click();
  await page.getByRole('button', { name: 'Send the approved change' }).click();
  await expect(page.getByText('Status: On')).toBeVisible({ timeout: 90_000 });
  await page.screenshot({ path: info.outputPath('recovery-on.png') });
  // The account's keystore is on chain now: signing out and back in resolves it.
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out on this device' }).click();
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page.getByText('Receive')).toBeVisible({ timeout: 60_000 });
  expect(seen.errors).toEqual([]);
});
