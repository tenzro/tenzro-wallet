import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

import { fund } from './authenticator';

export async function createAccount(page: Page, name = 'Playwright') {
  await page.goto('/');
  await page.getByPlaceholder('Alex').fill(name);
  const create = page.getByRole('button', { name: 'Create with a passkey' });
  await expect(create).toBeEnabled({ timeout: 30_000 });
  await create.click();
  await expect(page.getByText('Receive')).toBeVisible({ timeout: 60_000 });
  return page.evaluate(() => JSON.parse(localStorage.getItem('wallet') ?? '{}').account as string);
}

export async function fundAccount(page: Page, account: string, tnzo: string) {
  fund(account, tnzo);
  await page.goto('/');
  await expect(page.getByText(`${tnzo} TNZO`)).toBeVisible({ timeout: 60_000 });
}

import type { Browser, BrowserContext } from '@playwright/test';

import { addAuthenticator, watch } from './authenticator';

/** A second device: its own browser context (own storage) and its own authenticator. */
export async function newDevice(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  watch(page);
  await addAuthenticator(context, page);
  return { context, page };
}

/** Links device B to the account on page A; returns once A has approved B's request. */
export async function linkDevice(a: Page, b: Page): Promise<string> {
  await a.goto('/devices');
  await a.getByRole('button', { name: 'Show invite' }).click();
  const invite = await a.locator('textarea').first().inputValue();
  await b.goto('/devices#join');
  await b.getByPlaceholder('tzi1...').fill(invite);
  await b.getByRole('button', { name: 'Create a passkey here' }).click();
  // A passkey's post-quantum key is enrolled from its own account, which pays the fee.
  await expect(b.getByText("Fund this device's key")).toBeVisible({ timeout: 60_000 });
  fund((await b.locator('textarea').first().inputValue()).trim(), '1');
  await b.waitForTimeout(8000); // the node's mempool sees the funding one block later
  await b.getByRole('button', { name: 'Continue' }).click();
  await expect(b.getByText('Approve on your other device')).toBeVisible({ timeout: 90_000 });
  const code = await b.locator('textarea').first().inputValue();
  await a.goto('/requests');
  await a.getByPlaceholder('tzk1...').fill(code);
  await a.getByRole('button', { name: 'Read request' }).click();
  if (process.env.WALLET_E2E_DEBUG) {
    await a.waitForTimeout(5000);
    console.log(
      'A WALLET',
      (await a.evaluate(() => localStorage.getItem('wallet')))?.slice(0, 80),
      (await a.locator('main').innerText()).slice(-300).replace(/\n/g, ' | '),
    );
  }
  await a.getByRole('button', { name: 'Approve with passkey' }).click();
  // The nodes check the change with this approval; Send is enabled once they agree.
  await a.getByRole('button', { name: 'Send the approved change' }).click();
  await expect(a.getByText(/Sent\./)).toBeVisible({ timeout: 90_000 });
  return code;
}

/**
 * A new account's passkey enrols its post-quantum key from its own account,
 * which starts empty: fund that account (the address the page shows), then enrol.
 */
export async function finishSetup(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Finish setting up')).toBeVisible({ timeout: 30_000 });
  const fee = (await page.locator('textarea').first().inputValue()).trim();
  fund(fee, '1');
  await page.waitForTimeout(8000); // the node's mempool sees the funding one block later
  await page.getByRole('button', { name: 'Enrol the key' }).click();
  await expect(page.getByText('Finish setting up')).toHaveCount(0, { timeout: 90_000 });
}
