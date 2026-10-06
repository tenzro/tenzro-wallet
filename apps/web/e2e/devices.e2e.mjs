/**
 * Browser test of the device list in settings, for every state the network's
 * keystore can put a passkey in, against a built wallet and a mocked node.
 *
 * States: one device (sending off, with the reason and the add-device
 * action); two devices; a passkey linked but still waiting to count; a
 * passkey from another wallet provider, staked and not; a device joining by
 * recovery; and removing a device, sent as a keystore change signed by this
 * device's passkey. Every row must show a name, when it was added, its use
 * and where it stands in plain words: no empty field.
 *
 * Each state is captured at 1440 and 390 pixels wide into SHOTS_DIR (default
 * `e2e/screenshots`) for review.
 *
 * Needs the app built with NEXT_PUBLIC_TENZRO_RP_ID=localhost,
 * NEXT_PUBLIC_TENZRO_RPC_URL=http://rpc.test.invalid/ and
 * NEXT_PUBLIC_TENZRO_CHAIN_ID=1337, and served at BASE_URL.
 */

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3917';
const RPC = 'http://rpc.test.invalid/';
const SHOTS = process.env.SHOTS_DIR ?? new URL('./screenshots/', import.meta.url).pathname;
const ACCOUNT = `0x${'ac'.repeat(20)}`;
const ACCOUNT_SLOT = `${ACCOUNT}${'00'.repeat(12)}`;

function randomP256() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const xy = Buffer.concat([Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { xy, pkcs8: privateKey.export({ format: 'der', type: 'pkcs8' }) };
}

const cred = (key, id, extra = {}) => ({
  rp_id: 'localhost',
  credential_id: id.toString('hex'),
  public_key: key.xy.toString('hex'),
  aaguid: '00'.repeat(16),
  backup_eligible: false,
  backup_state: false,
  counts_as_root_from_ms: 0,
  label: '',
  added_at_ms: Date.UTC(2026, 9, 1, 9, 30),
  ...extra,
});

function mockNode(record) {
  const node = { record, sent: [], staked: new Set(['wallet.example.org']) };
  const handlers = {
    eth_chainId: () => '0x539',
    eth_gasPrice: () => '0x3b9aca00',
    tenzro_listRoleEndpoints: () => ({ endpoints: [] }),
    tenzro_getCheckpointCertificate: () => ({ index: 1, digest: 'cd'.repeat(32) }),
    tenzro_getNonce: () => `0x${node.sent.length.toString(16)}`,
    tenzro_getKeystore: () => ({
      account: ACCOUNT.slice(2),
      on_chain: true,
      keystore: node.record,
      commitment: createHash('sha256').update(JSON.stringify(node.record)).digest('hex'),
    }),
    tenzro_getWalletProvider: (p) => ({
      rp_id: p.rp_id,
      staked: node.staked.has(p.rp_id),
      providers: [],
    }),
    tenzro_getSigningPayload: (p) => {
      const preimage = JSON.stringify({
        chain_id: p.chain_id,
        from: p.from.slice(2),
        to: p.to.slice(2),
        nonce: p.nonce,
        gas_limit: p.gas_limit,
        gas_price: p.gas_price,
        timestamp: p.timestamp,
        valid_until: p.valid_until,
        action: p.tx_type,
      });
      return {
        kind: 'typed_action',
        digest: createHash('sha256').update(preimage).digest('hex'),
        preimage,
      };
    },
    tenzro_sendRawTransaction: (p) => {
      const op = p.tx_type?.KeystoreUpdate?.update?.op;
      assert.ok(op?.remove_credential, 'a keystore change removing a passkey');
      assert.equal(p.from, ACCOUNT_SLOT, 'sent from the account');
      node.record = {
        ...node.record,
        version: node.record.version + 1,
        credentials: node.record.credentials.filter(
          (c) => c.credential_id !== op.remove_credential.credential_id,
        ),
      };
      node.sent.push(p);
      return `0x${'34'.repeat(32)}`;
    },
  };
  node.answer = (method, params) => (handlers[method] ? handlers[method](params) : null);
  return node;
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const me = randomP256();
  const myId = randomBytes(16);
  const other = randomP256();
  const otherId = randomBytes(16);
  const base = {
    account: ACCOUNT.slice(2),
    owner_did: 'did:tenzro:human:e2e',
    salt: 0,
    version: 1,
    policy: 'single_credential',
    recovery_signers: [],
    recovery_threshold: 0,
    pending_recovery: null,
  };
  const later = Date.now() + 36 * 3_600_000;
  const states = {
    'one-device': { ...base, credentials: [cred(me, myId, { added_at_ms: 0 })] },
    'two-devices': {
      ...base,
      credentials: [cred(me, myId), cred(other, otherId, { label: 'Work laptop' })],
    },
    waiting: {
      ...base,
      credentials: [cred(me, myId), cred(other, otherId, { counts_as_root_from_ms: later })],
    },
    'other-provider': {
      ...base,
      credentials: [
        cred(me, myId),
        cred(other, otherId, { rp_id: 'wallet.example.org', label: 'Phone' }),
      ],
    },
    'unstaked-provider': {
      ...base,
      credentials: [cred(me, myId), cred(other, otherId, { rp_id: 'other.example.net' })],
    },
    recovering: {
      ...base,
      credentials: [cred(me, myId)],
      pending_recovery: {
        credential: cred(other, otherId, { label: 'New phone', added_at_ms: 0 }),
        approvers: [0],
        started_at_ms: Date.now(),
        ready_at_ms: later,
      },
    },
  };

  const browser = await chromium.launch();
  let passed = 0;
  try {
    for (const [name, record] of Object.entries(states)) {
      const node = mockNode(record);
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await ctx.route(`${RPC}**`, async (route) => {
        const req = route.request();
        const cors = {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
        };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        const body = req.postDataJSON();
        let payload;
        try {
          payload = {
            jsonrpc: '2.0',
            id: body.id,
            result: await node.answer(body.method, body.params),
          };
        } catch (e) {
          payload = { jsonrpc: '2.0', id: body.id, error: { code: -32000, message: String(e) } };
        }
        return route.fulfill({
          status: 200,
          headers: { ...cors, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      });
      await ctx.addInitScript(
        ([account, credentialId]) => {
          localStorage.setItem(
            'tenzro.wallet.v2',
            JSON.stringify({
              did: 'did:tenzro:human:e2e',
              account,
              credentialId,
              transports: ['internal'],
            }),
          );
        },
        [ACCOUNT, myId.toString('hex')],
      );
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('WebAuthn.enable', { enableUI: false });
      const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      });
      await cdp.send('WebAuthn.addCredential', {
        authenticatorId,
        credential: {
          credentialId: myId.toString('base64'),
          isResidentCredential: true,
          rpId: 'localhost',
          privateKey: me.pkcs8.toString('base64'),
          userHandle: Buffer.from(ACCOUNT.slice(2), 'hex').toString('base64'),
          signCount: 0,
        },
      });
      await page.goto(`${BASE}/settings`);
      const rows = page.locator('[data-device]');
      await rows.first().waitFor({ timeout: 30_000 });
      const texts = await rows.allInnerTexts();
      for (const t of texts) {
        assert.match(
          t,
          /Added (when the wallet was created|\d)|Not on the wallet yet/,
          `${name}: added`,
        );
        assert.match(t, /In use now|Last use is not recorded on the network/, `${name}: use`);
        assert.doesNotMatch(t, /—|not yet\b/, `${name}: nothing empty`);
      }
      const all = texts.join('\n');
      if (name === 'one-device') {
        assert.equal(texts.length, 1);
        assert.match(all, /Passkey on /, 'a default name');
        assert.match(await page.getByTestId('sending-disabled').innerText(), /Add a second device/);
      }
      if (name === 'two-devices') {
        assert.match(all, /Work laptop/);
        assert.equal(await page.getByTestId('sending-disabled').count(), 0, 'sending is on');
      }
      if (name === 'waiting') assert.match(all, /Linked; counts as a device from/);
      if (name === 'other-provider')
        assert.match(all, /From the wallet provider wallet\.example\.org · staked provider/);
      if (name === 'unstaked-provider') {
        assert.match(all, /From the wallet provider other\.example\.net/);
        assert.doesNotMatch(all, /staked provider/);
      }
      if (name === 'recovering')
        assert.match(
          all,
          /Joining by recovery; completes .*Any device on the wallet can cancel it/,
        );
      await page.screenshot({ path: `${SHOTS}devices-${name}-1440.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 900 });
      await page.screenshot({ path: `${SHOTS}devices-${name}-390.png`, fullPage: true });

      if (name === 'two-devices') {
        await page.setViewportSize({ width: 1440, height: 1000 });
        const row = page.locator(`[data-device="0x${otherId.toString('hex')}"]`);
        await row.getByRole('button', { name: 'Remove' }).click();
        await row.waitFor({ state: 'detached', timeout: 30_000 });
        assert.equal(node.sent.length, 1, 'one keystore change sent');
        await page.getByTestId('sending-disabled').waitFor();
        await page.screenshot({ path: `${SHOTS}devices-removed-1440.png`, fullPage: true });
      }
      await ctx.close();
      passed += 1;
      console.log(`ok - devices: ${name}`);
    }
    console.log(`\n${passed} passed`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
