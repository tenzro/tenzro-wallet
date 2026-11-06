import { expect, test } from '@playwright/test';

import { addAuthenticator, watch } from './authenticator';
import { createAccount, finishSetup, fundAccount } from './helpers';

test('turns the one-time recovery code on; the account then resolves from its passkey', async ({
  page,
  context,
}, info) => {
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
  await expect(page.getByText('Status: On')).toBeVisible({ timeout: 90_000 });
  await page.screenshot({ path: info.outputPath('recovery-on.png') });
  // The account's keystore is on chain now: signing out and back in resolves it.
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out on this device' }).click();
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page.getByText('Receive')).toBeVisible({ timeout: 60_000 });
  expect(seen.errors).toEqual([]);
});
