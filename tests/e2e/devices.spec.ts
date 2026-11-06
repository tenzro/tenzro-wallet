import { expect, test } from '@playwright/test';

import { addAuthenticator, watch } from './authenticator';
import { createAccount, finishSetup, fundAccount, linkDevice, newDevice } from './helpers';

test('links a second device with an invite and a request code; it waits before it counts', async ({
  page,
  context,
  browser,
}, info) => {
  const seen = watch(page);
  await addAuthenticator(context, page);
  const account = await createAccount(page);
  await fundAccount(page, account, '25');
  await finishSetup(page);
  const b = await newDevice(browser);
  await linkDevice(page, b.page);
  await page.goto('/devices');
  await expect(page.getByText(/Counts as a root in/)).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: info.outputPath('devices-a.png') });
  await b.page.getByRole('button', { name: 'It is approved' }).click();
  await expect(b.page.getByText('Receive')).toBeVisible({ timeout: 60_000 });
  await b.page.goto('/devices');
  await expect(b.page.getByText('This device')).toBeVisible();
  await b.page.screenshot({ path: info.outputPath('devices-b.png') });
  // Sign-in from the account now resolves: the keystore is on chain.
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out on this device' }).click();
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page.getByText('Receive')).toBeVisible({ timeout: 60_000 });
  expect(seen.errors).toEqual([]);
});
