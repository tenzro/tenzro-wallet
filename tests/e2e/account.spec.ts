import { expect, test } from '@playwright/test';

import { addAuthenticator, fund, rpc, watch } from './authenticator';
import { finishSetup } from './helpers';

test.describe('account', () => {
  test('the node answers for the chain the wallet was built for', async () => {
    const id = await rpc<string>('eth_chainId');
    expect(Number.parseInt(id, 16)).toBe(Number(process.env.WALLET_E2E_CHAIN ?? 13380));
  });

  test('registers a passkey, creates the account, and signs out', async ({
    page,
    context,
  }, info) => {
    const seen = watch(page);
    const auth = await addAuthenticator(context, page);
    await page.goto('/');
    await expect(page).toHaveTitle(/Wallet/);
    await page.getByPlaceholder('Alex').fill('Playwright');
    const create = page.getByRole('button', { name: 'Create with a passkey' });
    await expect(create).toBeEnabled({ timeout: 30_000 });
    await create.click();
    await expect(page.getByText('Receive')).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: info.outputPath('account.png') });
    const creds = await auth.credentials();
    expect(creds).toHaveLength(1);
    expect(creds[0]?.rpId).toBe('localhost');
    const account = await page.evaluate(
      () => JSON.parse(localStorage.getItem('wallet') ?? '{}').account as string,
    );
    expect(account).toMatch(/^0x[0-9a-f]{40,64}$/i);
    fund(account, '25');
    await page.reload();
    await expect(page.getByText('25 TNZO')).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: info.outputPath('funded.png') });
    await finishSetup(page);
    await page.getByRole('button', { name: 'Sign out on this device' }).click();
    // A fresh account has no keystore on chain until its first keystore change
    // (linking a device), so after signing out the passkey cannot be resolved yet.
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page.getByText(/No account on the network links this passkey yet/)).toBeVisible({
      timeout: 30_000,
    });
    expect(seen.errors).toEqual([]);
  });
});
