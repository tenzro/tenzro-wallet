import type { BrowserContext, CDPSession, Page } from '@playwright/test';

export interface VirtualAuthenticator {
  readonly cdp: CDPSession;
  readonly id: string;
  credentials(): Promise<{ credentialId: string; rpId: string; signCount: number }[]>;
  setUserVerified(ok: boolean): Promise<void>;
  remove(): Promise<void>;
}

/** A CTAP2 internal authenticator with resident keys, user verification and PRF. */
export async function addAuthenticator(
  context: BrowserContext,
  page: Page,
  opts: { hasPrf?: boolean; userVerified?: boolean } = {},
): Promise<VirtualAuthenticator> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: opts.userVerified ?? true,
      automaticPresenceSimulation: true,
      hasPrf: opts.hasPrf ?? true,
    },
  });
  return {
    cdp,
    id: authenticatorId,
    async credentials() {
      const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
      return credentials.map((c) => ({
        credentialId: c.credentialId,
        rpId: c.rpId ?? '',
        signCount: c.signCount,
      }));
    },
    async setUserVerified(ok) {
      await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: ok });
    },
    async remove() {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    },
  };
}

/** Collects console errors and failed requests so a test can assert there are none. */
export function watch(page: Page) {
  const errors: string[] = [];
  const failed: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  if (process.env.WALLET_E2E_DEBUG) {
    page.on('response', async (r) => {
      if (r.request().method() !== 'POST' || r.url() !== RPC) return;
      const body = await r.text().catch(() => '');
      if (body.includes('"error"')) {
        const method = /"method":"([^"]+)"/.exec(r.request().postData() ?? '')?.[1];
        console.log(`RPC ERROR ${method}: ${body.slice(0, 240)}`);
      }
    });
  }
  page.on('requestfailed', (r) =>
    failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`),
  );
  return { errors, failed };
}

export const RPC = process.env.WALLET_E2E_RPC ?? 'http://127.0.0.1:8545';

export async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result as T;
}

import { execFileSync } from 'node:child_process';
import { expect } from '@playwright/test';

/**
 * Funds `account` from the dev node's genesis-funded test account. The dev node
 * has no faucet; WALLET_E2E_FUND names a command taking `<address> <TNZO>`,
 * for example `ssh server3 /srv/walletdev-xxxx/fund.sh`.
 */
export function fund(account: string, tnzo: string): void {
  const cmd = process.env.WALLET_E2E_FUND;
  if (!cmd) throw new Error('Set WALLET_E2E_FUND to the command that funds an address.');
  const slot = account.length === 42 ? `${account}${'00'.repeat(12)}` : account;
  const [bin, ...args] = cmd.split(' ');
  execFileSync(bin as string, [...args, slot, tnzo], { stdio: 'pipe', timeout: 90_000 });
}

async function balanceOf(account: string): Promise<bigint> {
  const addr = `0x${account.replace(/^0x/, '').slice(0, 40)}`;
  return BigInt(await rpc<string>('eth_getBalance', [addr, 'latest']));
}

/** Resolves once the chain has produced `n` more blocks than it had when called. */
export async function untilBlocks(n = 1): Promise<void> {
  const start = Number.parseInt(await rpc<string>('eth_blockNumber'), 16);
  await expect
    .poll(async () => Number.parseInt(await rpc<string>('eth_blockNumber'), 16), {
      timeout: 120_000,
      intervals: [1_000],
    })
    .toBeGreaterThanOrEqual(start + n);
}

/**
 * Funds `account` and returns once the committed balance on chain has risen.
 */
export async function fundConfirmed(account: string, tnzo: string): Promise<void> {
  const before = await balanceOf(account);
  fund(account, tnzo);
  await expect
    .poll(() => balanceOf(account), { timeout: 120_000, intervals: [1_000] })
    .toBeGreaterThan(before);
}

/** Resolves once the account's keystore is in chain state. */
export async function untilKeystoreOnChain(account: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const v = await rpc<{ on_chain?: boolean }>('tenzro_getKeystore', [
          account.replace(/^0x/, '').slice(0, 40),
        ]);
        return v.on_chain === true;
      },
      { timeout: 120_000, intervals: [1_000] },
    )
    .toBe(true);
}

/** The account's committed transaction count; it rises when one of its transactions is included. */
export async function nonceOf(account: string): Promise<number> {
  const slot = account.length === 42 ? `${account}${'00'.repeat(12)}` : account;
  return Number.parseInt(await rpc<string>('tenzro_getNonce', [slot]), 16);
}

/** Resolves once a transaction of `account` has been included after `before`. */
export async function untilNonceAbove(account: string, before: number): Promise<void> {
  await expect
    .poll(() => nonceOf(account), { timeout: 120_000, intervals: [1_000] })
    .toBeGreaterThan(before);
}
