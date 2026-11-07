import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, chromium, expect, test } from '@playwright/test';

import { RPC, addAuthenticator, rpc } from './authenticator';

/**
 * The Manifest V3 extension, loaded unpacked (extension/dist, built with
 * EXT_RPC=$WALLET_E2E_RPC EXT_WALLET_ORIGIN=http://localhost:4173 EXT_RP_ID=localhost).
 */
const dist = fileURLToPath(new URL('../../extension/dist', import.meta.url));
// The dev node's genesis-funded test account: any funded address shows a balance.
const SEEDED =
  process.env.WALLET_E2E_FUNDED ??
  '0xf0172f9f4af468f364311f8eeab9f64d1286bc91000000000000000000000000';

let context: BrowserContext;
let id = '';

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'walext-')), {
    ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
    headless: false,
    args: [
      '--headless=new',
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      '--no-sandbox',
    ],
    viewport: { width: 360, height: 600 },
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  id = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context.close();
});

async function popup(opts: { scheme?: 'light' | 'dark' } = {}) {
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: opts.scheme ?? 'light' });
  await page.setViewportSize({ width: 360, height: 600 });
  await page.goto(`chrome-extension://${id}/popup.html`);
  return page;
}

async function seed(account: string | null) {
  const page = await popup();
  await page.evaluate(async (a) => {
    if (a) await chrome.storage.local.set({ wallet: { account: a, did: 'did:tenzro:human:test' } });
    else await chrome.storage.local.remove('wallet');
  }, account);
  await page.close();
}

test('the package is MV3 with minimal permissions and a strict CSP', async () => {
  const worker = context.serviceWorkers()[0] as { evaluate: <T>(f: () => T) => Promise<T> };
  const m = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(m.manifest_version).toBe(3);
  expect(m.permissions).toEqual(['storage']);
  expect(JSON.stringify(m.host_permissions)).not.toContain('<all_urls>');
  const csp = (m.content_security_policy as { extension_pages: string }).extension_pages;
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe');
  expect(csp).not.toMatch(/script-src[^;]*https?:/);
});

test('signed out and connected to the network', async ({ browserName: _browser }, info) => {
  await seed(null);
  const page = await popup();
  await expect(page.getByRole('button', { name: 'Open wallet' })).toBeVisible();
  await expect(page.getByText('Your account')).toBeVisible();
  await page.screenshot({ path: info.outputPath('popup-signed-out.png') });
});

test('an account shows its balance, receive and send', async ({ browserName: _browser }, info) => {
  const chain = Number.parseInt(await rpc<string>('eth_chainId'), 16);
  expect(chain).toBe(Number(process.env.WALLET_E2E_CHAIN ?? 13380));
  await seed(SEEDED);
  const page = await popup();
  await expect(page.getByText('Balance')).toBeVisible();
  await expect(page.getByText(/TNZO/).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('popup-account.png') });
  await page.screenshot({ path: info.outputPath('popup-account-dark.png') });
  await page.getByRole('button', { name: 'Receive' }).click();
  await expect(page.getByText('Payments to this account')).toBeVisible();
  await page.screenshot({ path: info.outputPath('popup-receive.png') });
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByPlaceholder('0x...').fill(SEEDED);
  await page.getByPlaceholder('0.0').fill('1');
  await page.screenshot({ path: info.outputPath('popup-send.png') });
  const review = page.getByRole('button', { name: 'Review in wallet' });
  await expect(review).toBeEnabled();
  const opened = context.waitForEvent('page');
  await review.click();
  const bridge = await opened;
  // The extension never signs: it opens its bridge tab, which hands the request to the wallet page.
  expect(bridge.url()).toContain(`chrome-extension://${id}/bridge.html`);
  await expect(bridge.getByText('Approve a payment in your wallet')).toBeVisible();
  const wallet = context.waitForEvent('page');
  await bridge.getByRole('button', { name: 'Continue in wallet' }).click();
  expect((await wallet).url()).toContain('localhost:4173/approve');
});

test('a node that answers for another chain is refused', async ({
  browserName: _browser,
}, info) => {
  await seed(SEEDED);
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 600 });
  await page.route(RPC, async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { method?: string };
    if (body.method === 'eth_chainId') {
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x539' }),
      });
    }
    return route.continue();
  });
  await page.goto(`chrome-extension://${id}/popup.html`);
  await expect(page.getByRole('alert')).toContainText('chain 1337', { timeout: 30_000 });
  await page.screenshot({ path: info.outputPath('popup-error.png') });
});

test('signed out: connect hands over to the bridge; no passkey is made in the extension', async ({
  browserName: _browser,
}, info) => {
  await seed(null);
  const page = await popup();
  await expect(page.getByPlaceholder('Alex')).toHaveCount(0);
  const opened = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  const bridge = await opened;
  await expect(bridge.getByText('Connect your wallet')).toBeVisible();
  await bridge.screenshot({ path: info.outputPath('bridge-connect.png') });
});
