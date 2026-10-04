/**
 * Browser test of the guardian screens against a built wallet and a mocked
 * node. Chromium's virtual WebAuthn authenticator (CDP) holds every passkey,
 * so each ceremony is a real navigator.credentials call.
 *
 * Covers: making a guardian passkey (/guardian), adding it from settings with
 * the quorum preview, starting a recovery (/recover), the guardian approving
 * it from the request link, and completing it.
 *
 * Every request the mock node receives is checked against what the node
 * verifies: the custody target and digest, and the passkey signatures over
 * them (P-256 over authenticatorData || SHA-256(clientDataJSON)).
 *
 * Needs the app built with NEXT_PUBLIC_TENZRO_RP_ID=localhost and
 * NEXT_PUBLIC_TENZRO_RPC_URL=http://rpc.test.invalid/ and served at BASE_URL
 * (`pnpm build && pnpm start -p 3917`). Run: `pnpm test:e2e`.
 */

import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, verify } from 'node:crypto';

import { chromium } from 'playwright';
import {
  SignatureContext,
  base64Url,
  bytesToHex,
  custodyChallengeDigest,
  decodeGuardianCard,
  guardianTarget,
  hexToBytes,
  recoveryApprovalChallenge,
  recoveryOpHash,
  webauthnChallenge,
} from 'tenzro-wallet/custody';

const BASE = process.env.BASE_URL ?? 'http://localhost:3917';
const RPC = 'http://rpc.test.invalid/';
const ACCOUNT = `0x${'ac'.repeat(20)}`;
const SYNCED_AAGUID = `0x${'a1'.repeat(16)}`;

const hex = (b) => bytesToHex(b, true);
const strip = (h) => h.replace(/^0x/, '').toLowerCase();

function randomP256() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const xy = Buffer.concat([Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { xy, pkcs8: privateKey.export({ format: 'der', type: 'pkcs8' }) };
}

/** Verifies a WebAuthn assertion by the P-256 key `xy` over `challenge` (base64url). */
function verifyAssertion({ authenticatorData, clientDataJson, signature }, xy, challenge, what) {
  const cd = JSON.parse(Buffer.from(clientDataJson).toString('utf8'));
  assert.equal(cd.type, 'webauthn.get', `${what}: ceremony`);
  assert.equal(cd.challenge, challenge, `${what}: challenge`);
  assert.equal(cd.origin, new URL(BASE).origin, `${what}: origin`);
  const ad = Buffer.from(authenticatorData);
  assert.ok(ad.subarray(0, 32).equals(createHash('sha256').update('localhost').digest()), `${what}: rpIdHash`);
  assert.ok((ad[32] & 0x05) === 0x05, `${what}: user present and verified`);
  const key = createPublicKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: Buffer.from(xy.subarray(0, 32)).toString('base64url'),
      y: Buffer.from(xy.subarray(32)).toString('base64url'),
    },
  });
  const signed = Buffer.concat([ad, createHash('sha256').update(Buffer.from(clientDataJson)).digest()]);
  assert.ok(verify('sha256', signed, key, Buffer.from(signature)), `${what}: signature`);
}

/** The mocked node: answers the wallet's JSON-RPC and records each call. */
function mockNode(accountKey) {
  const calls = [];
  const challenges = new Map();
  let n = 0;
  const node = {
    calls,
    members: [
      { index: 0, p256_pubkey_hex: hex(randomP256().xy), role: 'device', aaguid: SYNCED_AAGUID, backup_eligible: true, backup_state: true, label: 'Phone' },
      { index: 1, p256_pubkey_hex: hex(randomP256().xy), role: 'device', aaguid: SYNCED_AAGUID, backup_eligible: true, backup_state: true, label: 'Laptop' },
    ],
    threshold: 1,
    pending: null,
    newCredentialIds: [],
    challenges,
  };
  const handlers = {
    tenzro_listGuardians: () => ({ threshold: node.threshold, independent_roots: 1, members: node.members }),
    tenzro_listPendingRecoveries: () => ({ pending_recoveries: node.pending ? [node.pending] : [] }),
    tenzro_createCustodyChallenge: (p) => {
      n += 1;
      const nonce = randomBytes(16);
      const target = hexToBytes(p.target_hex ?? '0x');
      const digest = custodyChallengeDigest(hexToBytes(p.account_address), p.operation, target, nonce);
      const id = `c${n}`;
      challenges.set(id, { ...p, digest });
      return {
        challenge_id: id,
        challenge_hex: hex(digest),
        webauthn_challenge: webauthnChallenge(SignatureContext.AccountOwner, digest),
        nonce_hex: hex(nonce),
        target_hex: hex(target),
        expires_in_secs: 300,
      };
    },
    tenzro_addGuardian: (p) => {
      node.members = [
        ...node.members,
        { index: node.members.length, p256_pubkey_hex: p.guardian_p256_pubkey_hex, role: p.role, aaguid: '0x', backup_eligible: false, backup_state: false, label: p.label ?? '' },
      ];
      node.threshold = p.threshold;
      return { guardian_count: node.members.length, threshold: p.threshold };
    },
    tenzro_initiateRecovery: (p) => {
      const pub = hexToBytes(p.new_passkey_public_key_hex);
      const cred = hexToBytes(p.new_credential_id_hex);
      const expires = Date.now() + 3_600_000;
      node.pending = {
        recovery_id: 'rec-1',
        new_credential_id_hex: p.new_credential_id_hex,
        new_passkey_public_key_hex: p.new_passkey_public_key_hex,
        created_at_ms: Date.now(),
        expires_at_ms: expires,
        ready_at_ms: null,
        guardian_signatures_collected: 0,
        finalized: false,
        cancelled: false,
      };
      node.newCredentialIds.push(strip(p.new_credential_id_hex));
      return {
        recovery_id: 'rec-1',
        account_address: p.account_address,
        recovery_op_hash_hex: hex(
          recoveryOpHash({ account: p.account_address, newPasskeyPublicKey: pub, newCredentialId: cred, recoveryId: 'rec-1', expiresAtMs: expires }),
        ),
        expires_at_ms: expires,
        guardians_required: node.threshold,
        guardians_total: node.members.length,
      };
    },
    tenzro_submitRecoverySignature: () => {
      node.pending = { ...node.pending, guardian_signatures_collected: 2, ready_at_ms: Date.now() - 1000 };
      return { guardian_signatures_collected: 2, guardians_required: 2, quorum_reached: true, ready_at_ms: node.pending.ready_at_ms };
    },
    tenzro_finalizeRecovery: () => {
      node.pending = { ...node.pending, finalized: true };
      return { recovery_id: 'rec-1', finalized: true };
    },
    tenzro_listPasskeys: () => ({ account_address: ACCOUNT, count: 1, credential_ids: node.newCredentialIds }),
    tenzro_getAccountRecord: () => ({
      record: { account_address: ACCOUNT, owner_did: 'did:tenzro:human:e2e', credentials: [] },
    }),
  };
  node.answer = (method, params) => {
    calls.push({ method, params });
    const h = handlers[method];
    return h ? h(params) : null;
  };
  node.accountKey = accountKey;
  return node;
}

async function withNode(context, node) {
  await context.route(`${RPC}**`, async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = req.postDataJSON();
    let payload;
    try {
      payload = { jsonrpc: '2.0', id: body.id, result: node.answer(body.method, body.params) };
    } catch (e) {
      payload = { jsonrpc: '2.0', id: body.id, error: { code: -32000, message: String(e) } };
    }
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  });
}

/** A page with a virtual platform authenticator (user verification always passes). */
async function pageWithAuthenticator(context) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
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
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { page, cdp, authenticatorId, errors };
}

const longToken = (page) =>
  page.evaluate(() => {
    for (const el of document.querySelectorAll('main *')) {
      const t = el.textContent?.trim() ?? '';
      if (el.children.length === 0 && /^[A-Za-z0-9_-]{200,}$/.test(t)) return t;
    }
    return null;
  });

async function main() {
  const browser = await chromium.launch();
  const results = [];
  const step = async (name, fn) => {
    await fn();
    results.push(name);
    console.log(`ok - ${name}`);
  };
  try {
    const accountKey = randomP256();
    const accountCredId = randomBytes(16);
    const node = mockNode(accountKey);

    // ── Guardian device: make a guardian passkey ───────────────────────────
    const gctx = await browser.newContext();
    await withNode(gctx, node);
    const g = await pageWithAuthenticator(gctx);
    let cardText = '';
    await step('guardian: makes a guardian passkey and shows its card', async () => {
      await g.page.goto(`${BASE}/guardian`);
      await g.page.getByLabel('Guardian name').fill('Sam');
      await g.page.getByRole('button', { name: 'Make guardian passkey' }).click();
      await g.page.getByRole('button', { name: 'Copy' }).waitFor();
      cardText = await longToken(g.page);
      assert.ok(cardText, 'card shown');
      const card = decodeGuardianCard(cardText);
      assert.equal(card.label, 'Sam');
      assert.equal(card.role, 'device');
      const { credentials } = await g.cdp.send('WebAuthn.getCredentials', { authenticatorId: g.authenticatorId });
      assert.equal(credentials.length, 1);
      assert.equal(strip(card.credentialId), Buffer.from(credentials[0].credentialId, 'base64').toString('hex'));
    });

    // ── Account holder: add the guardian from settings ─────────────────────
    const hctx = await browser.newContext();
    await withNode(hctx, node);
    await hctx.addInitScript(
      ([account, credentialId]) => {
        if (!localStorage.getItem('tenzro.wallet.v2')) {
          localStorage.setItem(
            'tenzro.wallet.v2',
            JSON.stringify({ did: 'did:tenzro:human:e2e', account, credentialId, transports: ['internal'], tier: 'device-bound' }),
          );
        }
      },
      [ACCOUNT, accountCredId.toString('hex')],
    );
    const h = await pageWithAuthenticator(hctx);
    await h.cdp.send('WebAuthn.addCredential', {
      authenticatorId: h.authenticatorId,
      credential: {
        credentialId: accountCredId.toString('base64'),
        isResidentCredential: true,
        rpId: 'localhost',
        privateKey: accountKey.pkcs8.toString('base64'),
        userHandle: Buffer.from(ACCOUNT.slice(2), 'hex').toString('base64'),
        signCount: 0,
      },
    });

    await step('settings: previews the quorum the new guardian makes', async () => {
      await h.page.goto(`${BASE}/settings`);
      await h.page.getByLabel('Guardian card').fill(cardText);
      const threshold = h.page.getByLabel('Approvals needed');
      const add = h.page.getByRole('button', { name: 'Approve and add' });
      await threshold.waitFor();
      // Two passkeys synced through one provider count once: 2 roots, default 2.
      assert.equal(await threshold.inputValue(), '2');
      await h.page.getByText('of 2 independent providers').waitFor();
      assert.ok(await add.isEnabled());
      await threshold.fill('3');
      await h.page.getByText(/amount to 2 independent provider/).waitFor();
      assert.ok(await add.isDisabled(), 'a threshold above the roots is refused');
      await threshold.fill('1');
      await h.page.getByText(/One guardian can recover this account alone/).waitFor();
      assert.ok(await add.isEnabled());
      await threshold.fill('2');
    });

    await step('settings: adds the guardian with a passkey approval bound to its card', async () => {
      await h.page.getByRole('button', { name: 'Approve and add' }).click();
      await h.page.getByText('Guardian added.').waitFor();
      const card = decodeGuardianCard(cardText);
      const add = node.calls.find((c) => c.method === 'tenzro_addGuardian').params;
      assert.deepEqual(Object.keys(add).sort(), [
        'account_address',
        'authorization',
        'guardian_credential_id_hex',
        'guardian_p256_pubkey_hex',
        'guardian_registration_authenticator_data_hex',
        'label',
        'role',
        'threshold',
      ]);
      assert.equal(add.label, 'Sam');
      assert.equal(add.threshold, 2);
      const ch = node.challenges.get(add.authorization.challenge_id);
      assert.equal(ch.operation, 'add_guardian');
      assert.equal(strip(ch.target_hex), strip(hex(guardianTarget(card))));
      assert.equal(strip(add.authorization.credential_id_hex), accountCredId.toString('hex'));
      const a = add.authorization.assertion;
      verifyAssertion(
        { authenticatorData: a.authenticator_data, clientDataJson: a.client_data_json, signature: a.signature },
        accountKey.xy,
        webauthnChallenge(SignatureContext.AccountOwner, ch.digest),
        'add_guardian authorization',
      );
      await h.page.getByText('Sam').first().waitFor();
    });

    // ── New device: start recovery ─────────────────────────────────────────
    const rctx = await browser.newContext();
    await withNode(rctx, node);
    const r = await pageWithAuthenticator(rctx);
    let link = '';
    await step('recover: makes a new passkey and shows the request link', async () => {
      await r.page.goto(`${BASE}/recover`);
      await r.page.getByLabel('Account address').fill(ACCOUNT);
      await r.page.getByLabel('Device name').fill('New phone');
      await r.page.getByRole('button', { name: 'Make a passkey and start recovery' }).click();
      await r.page.getByRole('button', { name: 'Start over' }).waitFor();
      link = await r.page.evaluate(() => /https?:\/\/\S+\/guardian#r=[A-Za-z0-9_-]+/.exec(document.body.innerHTML)?.[0] ?? '');
      assert.ok(link, 'request link shown');
      const init = node.calls.find((c) => c.method === 'tenzro_initiateRecovery').params;
      assert.deepEqual(Object.keys(init).sort(), [
        'account_address',
        'new_credential_id_hex',
        'new_passkey_public_key_hex',
        'new_registration_authenticator_data_hex',
      ]);
      const { credentials } = await r.cdp.send('WebAuthn.getCredentials', { authenticatorId: r.authenticatorId });
      assert.equal(credentials.length, 1);
      assert.equal(Buffer.from(credentials[0].userHandle, 'base64').toString('hex'), ACCOUNT.slice(2));
    });

    // ── Guardian device: approve from the link ─────────────────────────────
    await step('guardian: approves the recovery from the link with its guardian passkey', async () => {
      // Opened fresh, as a guardian opens the link they were sent.
      await g.page.goto('about:blank');
      await g.page.goto(link);
      await g.page.getByText('New passkey').first().waitFor();
      await g.page.getByRole('button', { name: 'Approve with my guardian passkey' }).click();
      await g.page.getByText(/Approved\. 2 of 2/).waitFor();
      const sub = node.calls.find((c) => c.method === 'tenzro_submitRecoverySignature').params;
      assert.equal(sub.recovery_id, 'rec-1');
      assert.equal(sub.guardian_index, 2, 'the index the guardian key holds');
      assert.equal(sub.signature.pq, undefined);
      const p = node.pending;
      const opHash = recoveryOpHash({
        account: ACCOUNT,
        newPasskeyPublicKey: hexToBytes(p.new_passkey_public_key_hex),
        newCredentialId: hexToBytes(p.new_credential_id_hex),
        recoveryId: 'rec-1',
        expiresAtMs: p.expires_at_ms,
      });
      const c = sub.signature.classical;
      assert.equal(c.form, 'web_authn');
      verifyAssertion(
        {
          authenticatorData: hexToBytes(c.authenticator_data),
          clientDataJson: hexToBytes(c.client_data_json),
          signature: hexToBytes(c.signature),
        },
        Buffer.from(hexToBytes(decodeGuardianCard(cardText).p256)),
        base64Url(recoveryApprovalChallenge(opHash)),
        'recovery approval',
      );
    });

    // ── New device: complete and sign in ───────────────────────────────────
    await step('recover: completes once ready and signs in with the new passkey', async () => {
      const done = r.page.getByRole('button', { name: 'Complete recovery' });
      await r.page.waitForFunction(
        () => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Complete recovery') && !b.disabled),
        null,
        { timeout: 60_000 },
      );
      await done.click();
      await r.page.waitForURL(/\/dashboard/, { timeout: 30_000 });
      assert.ok(node.calls.some((c) => c.method === 'tenzro_finalizeRecovery'));
      const stored = JSON.parse(await r.page.evaluate(() => localStorage.getItem('tenzro.wallet.v2')));
      assert.equal(stored.account, ACCOUNT);
      assert.equal(stored.credentialId, node.newCredentialIds[0]);
    });

    for (const [name, x] of [['guardian', g], ['holder', h], ['recover', r]]) {
      assert.deepEqual(x.errors, [], `${name} page errors`);
    }
    console.log(`\n${results.length} passed`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
