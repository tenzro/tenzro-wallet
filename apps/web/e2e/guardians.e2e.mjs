/**
 * Browser test of the guardian screens against a built wallet and a mocked
 * node that holds the account's keystore. Chromium's virtual WebAuthn
 * authenticator (CDP) holds every passkey, so each ceremony is a real
 * navigator.credentials call.
 *
 * Covers: making a guardian passkey (/guardian), adding it from settings with
 * the quorum preview, starting a recovery (/recover), the guardian approving
 * it from the request link with an approval code, sending the recovery with
 * the approvals, and completing it.
 *
 * Every keystore change reaches the mock node as a transaction from the
 * account, and is checked as the node checks it: the passkey signature over
 * the transaction digest, and each guardian approval over the change's digest
 * (P-256 over authenticatorData || SHA-256(clientDataJSON)).
 *
 * Needs the app built with NEXT_PUBLIC_TENZRO_RP_ID=localhost and
 * NEXT_PUBLIC_TENZRO_RPC_URL=http://rpc.test.invalid/ and
 * NEXT_PUBLIC_TENZRO_CHAIN_ID=1337, and served at BASE_URL
 * (`pnpm build && pnpm start -p 3917`). Run: `pnpm test:e2e`.
 */

import assert from 'node:assert/strict';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';

import { chromium } from 'playwright';
import { TRANSACTION_SIGNATURE_CONTEXT, compositeMessageRepresentative } from 'tenzro-sdk';
import {
  SignatureContext,
  bytesToHex,
  decodeGuardianCard,
  decodeRecoveryRequest,
  encodeRecoveryApproval,
  hexToBytes,
  keystoreDigest,
  webauthnChallenge,
} from 'tenzro-wallet/custody';

const BASE = process.env.BASE_URL ?? 'http://localhost:3917';
const RPC = 'http://rpc.test.invalid/';
const ACCOUNT = `0x${'ac'.repeat(20)}`;
const ACCOUNT_SLOT = `${ACCOUNT}${'00'.repeat(12)}`;
const SYNCED_AAGUID = 'a1'.repeat(16);

const hex = (b) => bytesToHex(b, true);
const strip = (h) => h.replace(/^0x/, '').toLowerCase();
const b64u = (b) => Buffer.from(b).toString('base64url');

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
  assert.ok(
    ad.subarray(0, 32).equals(createHash('sha256').update('localhost').digest()),
    `${what}: rpIdHash`,
  );
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
  const signed = Buffer.concat([
    ad,
    createHash('sha256').update(Buffer.from(clientDataJson)).digest(),
  ]);
  assert.ok(verify('sha256', signed, key, Buffer.from(signature)), `${what}: signature`);
}

/** A WebAuthn assertion made outside the browser, as another guardian's device makes one. */
function assertOutside(pkcs8, challenge) {
  const ad = Buffer.concat([
    createHash('sha256').update('localhost').digest(),
    Buffer.from([0x05, 0, 0, 0, 1]),
  ]);
  const cd = Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge,
      origin: new URL(BASE).origin,
      crossOrigin: false,
    }),
  );
  const key = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const sig = sign('sha256', Buffer.concat([ad, createHash('sha256').update(cd).digest()]), key);
  return {
    classical: {
      form: 'web_authn',
      authenticator_data: ad.toString('hex'),
      client_data_json: cd.toString('hex'),
      signature: sig.toString('hex'),
    },
  };
}

const credentialOf = (key, credId, label, extra = {}) => ({
  rp_id: 'localhost',
  credential_id: credId.toString('hex'),
  public_key: key.xy.toString('hex'),
  aaguid: '00'.repeat(16),
  backup_eligible: false,
  backup_state: false,
  counts_as_root_from_ms: 0,
  label,
  ...extra,
});

/**
 * The mocked node: holds the account's keystore, answers the wallet's
 * JSON-RPC, and applies each keystore change sent to it once it checks.
 */
function mockNode(accountKey, accountCredId, phone, laptop) {
  const calls = [];
  const payloads = new Map();
  const signer = (key, label) => ({
    rp_id: 'localhost',
    public_key: key.xy.toString('hex'),
    aaguid: SYNCED_AAGUID,
    backup_eligible: true,
    backup_state: true,
    role: 'device',
    label,
  });
  const node = {
    calls,
    sent: [],
    record: {
      account: ACCOUNT.slice(2),
      owner_did: 'did:tenzro:human:e2e',
      salt: 0,
      version: 1,
      credentials: [credentialOf(accountKey, accountCredId, 'Laptop')],
      policy: 'single_credential',
      recovery_signers: [signer(phone, 'Phone'), signer(laptop, 'Laptop')],
      recovery_threshold: 1,
      pending_recovery: null,
    },
  };
  node.commitment = () => createHash('sha256').update(JSON.stringify(node.record)).digest('hex');
  const keyOf = (pk) => Buffer.from(pk, 'hex');
  /** Checks the transaction's passkey signature by `publicKey` over its payload digest. */
  const checkTx = async (p, what) => {
    const digest = [...payloads.keys()].find((d) => payloads.get(d).timestamp === p.timestamp);
    assert.ok(digest, `${what}: a payload the node issued`);
    assert.equal(p.from, ACCOUNT_SLOT, `${what}: sent from the account`);
    const c = p.signature.classical;
    assert.equal(c.form, 'web_authn', `${what}: passkey form`);
    const mPrime = await compositeMessageRepresentative(
      TRANSACTION_SIGNATURE_CONTEXT,
      hexToBytes(digest),
    );
    verifyAssertion(
      {
        authenticatorData: Buffer.from(c.authenticator_data, 'hex'),
        clientDataJson: Buffer.from(c.client_data_json, 'hex'),
        signature: Buffer.from(c.signature, 'hex'),
      },
      keyOf(strip(p.public_key)),
      b64u(createHash('sha256').update(mPrime).digest()),
      what,
    );
  };
  const handlers = {
    eth_chainId: () => '0x539',
    tenzro_listRoleEndpoints: () => ({ endpoints: [] }),
    tenzro_getCheckpointCertificate: () => ({ index: 1, digest: 'cd'.repeat(32) }),
    tenzro_getNonce: () => `0x${node.sent.length.toString(16)}`,
    tenzro_getKeystore: (p) => {
      assert.equal(strip(p.account), ACCOUNT.slice(2), 'keystore of the account');
      return {
        account: ACCOUNT.slice(2),
        on_chain: true,
        keystore: node.record,
        commitment: node.commitment(),
      };
    },
    tenzro_resolveCredential: (p) => ({
      accounts: node.record.credentials.some(
        (c) => c.credential_id === strip(p.credential_id) && c.rp_id === p.rp_id,
      )
        ? [ACCOUNT.slice(2)]
        : [],
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
      const digest = createHash('sha256').update(preimage).digest('hex');
      payloads.set(digest, p);
      return { kind: 'typed_action', digest, preimage };
    },
    tenzro_sendRawTransaction: async (p) => {
      const u = p.tx_type?.KeystoreUpdate?.update;
      assert.ok(u, 'a keystore change');
      assert.equal(strip(u.account), ACCOUNT.slice(2));
      assert.equal(strip(u.previous_commitment), node.commitment(), 'names the current keystore');
      await checkTx(p, 'keystore change');
      const signerKey = strip(p.public_key);
      const linked = node.record.credentials.some((c) => c.public_key === signerKey);
      const op = u.op;
      if (op.set_recovery) {
        assert.ok(linked, 'sent by a linked passkey');
        node.record = {
          ...node.record,
          recovery_signers: op.set_recovery.signers,
          recovery_threshold: op.set_recovery.threshold,
        };
      } else if (op.start_recovery) {
        assert.equal(
          signerKey,
          op.start_recovery.credential.public_key,
          'sent by the joining passkey',
        );
        const digest = keystoreDigest(u.account, u.previous_commitment, op);
        const want = webauthnChallenge(SignatureContext.RecoveryApproval, digest);
        const approvers = u.approvals.map((a) => {
          const i = node.record.recovery_signers.findIndex(
            (s) => s.public_key === strip(a.public_key),
          );
          assert.ok(i >= 0, 'approved by a recovery signer');
          const c = a.signature.classical;
          verifyAssertion(
            {
              authenticatorData: Buffer.from(c.authenticator_data, 'hex'),
              clientDataJson: Buffer.from(c.client_data_json, 'hex'),
              signature: Buffer.from(c.signature, 'hex'),
            },
            keyOf(strip(a.public_key)),
            want,
            `recovery approval ${i}`,
          );
          return i;
        });
        node.approvers = approvers;
        node.record = {
          ...node.record,
          pending_recovery: {
            credential: op.start_recovery.credential,
            approvers,
            started_at_ms: Date.now(),
            ready_at_ms: Date.now() - 1000,
          },
        };
      } else if (op === 'finish_recovery') {
        assert.equal(
          signerKey,
          node.record.pending_recovery?.credential.public_key,
          'sent by the joining passkey',
        );
        node.record = {
          ...node.record,
          credentials: [...node.record.credentials, node.record.pending_recovery.credential],
          pending_recovery: null,
        };
      } else {
        throw new Error(`unexpected change ${JSON.stringify(op)}`);
      }
      node.record = { ...node.record, version: node.record.version + 1 };
      node.sent.push(p);
      return `0x${'34'.repeat(32)}`;
    },
  };
  node.answer = async (method, params) => {
    calls.push({ method, params });
    const h = handlers[method];
    return h ? h(params) : null;
  };
  return node;
}

async function withNode(context, node) {
  await context.route(`${RPC}**`, async (route) => {
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
    const phone = randomP256();
    const node = mockNode(accountKey, accountCredId, phone, randomP256());

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
      assert.equal(card.rpId, 'localhost', 'the card names its wallet provider');
      const { credentials } = await g.cdp.send('WebAuthn.getCredentials', {
        authenticatorId: g.authenticatorId,
      });
      assert.equal(credentials.length, 1);
      assert.equal(
        strip(card.credentialId),
        Buffer.from(credentials[0].credentialId, 'base64').toString('hex'),
      );
    });

    // ── Account holder: add the guardian from settings ─────────────────────
    const hctx = await browser.newContext();
    await withNode(hctx, node);
    await hctx.addInitScript(
      ([account, credentialId]) => {
        if (!localStorage.getItem('tenzro.wallet.v2')) {
          localStorage.setItem(
            'tenzro.wallet.v2',
            JSON.stringify({
              did: 'did:tenzro:human:e2e',
              account,
              credentialId,
              transports: ['internal'],
              tier: 'device-bound',
            }),
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

    await step(
      'settings: adds the guardian in a keystore change sent with the passkey',
      async () => {
        await h.page.getByRole('button', { name: 'Approve and add' }).click();
        await h.page.getByText('Guardian added.').waitFor();
        const card = decodeGuardianCard(cardText);
        const sent = node.sent.at(-1);
        assert.equal(
          strip(sent.public_key),
          accountKey.xy.toString('hex'),
          'signed by the account passkey',
        );
        const op = sent.tx_type.KeystoreUpdate.update.op.set_recovery;
        assert.equal(op.threshold, 2);
        const sam = op.signers.at(-1);
        assert.equal(sam.public_key, strip(card.p256));
        assert.equal(sam.rp_id, 'localhost');
        assert.equal(sam.label, 'Sam');
        assert.equal(op.signers.length, 3, 'the existing signers kept');
        await h.page.getByText('Sam').first().waitFor();
      },
    );

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
      link = await r.page.evaluate(
        () => /https?:\/\/\S+\/guardian#r=[A-Za-z0-9_-]+/.exec(document.body.innerHTML)?.[0] ?? '',
      );
      assert.ok(link, 'request link shown');
      assert.equal(node.sent.length, 1, 'nothing sent before the guardians approve');
      const { credentials } = await r.cdp.send('WebAuthn.getCredentials', {
        authenticatorId: r.authenticatorId,
      });
      assert.equal(credentials.length, 1);
      assert.equal(
        Buffer.from(credentials[0].userHandle, 'base64').toString('hex'),
        ACCOUNT.slice(2),
      );
    });

    // ── Guardian device: approve from the link ─────────────────────────────
    let samCode = '';
    await step('guardian: approves the recovery from the link and hands back a code', async () => {
      // Opened fresh, as a guardian opens the link they were sent.
      await g.page.goto('about:blank');
      await g.page.goto(link);
      await g.page.getByText('New passkey').first().waitFor();
      await g.page.getByRole('button', { name: 'Approve with my guardian passkey' }).click();
      await g.page.getByRole('button', { name: 'Copy approval code' }).waitFor();
      samCode = await longToken(g.page);
      assert.ok(samCode, 'approval code shown');
    });

    // ── New device: send with the approvals, then complete ─────────────────
    await step(
      'recover: sends the recovery with the approvals, signed by the new passkey',
      async () => {
        const send = r.page.getByRole('button', { name: 'Send the recovery' });
        await r.page.getByLabel('Guardian approval code').fill(samCode);
        await r.page.getByRole('button', { name: 'Add', exact: true }).click();
        await r.page.getByText(/1 of 2 approvals needed/).waitFor();
        assert.ok(await send.isDisabled(), 'one provider is not enough');
        // The second approval comes from a guardian on another provider's device.
        const request = new URL(link).hash.slice(3);
        const u = decodeRecoveryRequest(request).update;
        const challenge = webauthnChallenge(
          SignatureContext.RecoveryApproval,
          keystoreDigest(u.account, u.previous_commitment, u.op),
        );
        const phoneCode = encodeRecoveryApproval({
          account: u.account,
          public_key: phone.xy.toString('hex'),
          signature: assertOutside(phone.pkcs8, challenge),
        });
        await r.page.getByLabel('Guardian approval code').fill(phoneCode);
        await r.page.getByRole('button', { name: 'Add', exact: true }).click();
        await r.page.getByText(/2 of 2 approvals needed/).waitFor();
        await send.click();
        await r.page.getByText(/The wait is over/).waitFor({ timeout: 60_000 });
        const sent = node.sent.at(-1);
        const op = sent.tx_type.KeystoreUpdate.update.op.start_recovery;
        assert.ok(op, 'a recovery start');
        assert.equal(strip(sent.public_key), op.credential.public_key, 'signed by the new passkey');
        assert.deepEqual([...node.approvers].sort(), [0, 2], 'approved by the phone and by Sam');
      },
    );

    await step('recover: completes once ready and signs in with the new passkey', async () => {
      await r.page.getByRole('button', { name: 'Complete recovery' }).click();
      await r.page.waitForURL(/\/dashboard/, { timeout: 30_000 });
      assert.equal(node.sent.at(-1).tx_type.KeystoreUpdate.update.op, 'finish_recovery');
      const joined = node.record.credentials.at(-1);
      const stored = JSON.parse(
        await r.page.evaluate(() => localStorage.getItem('tenzro.wallet.v2')),
      );
      assert.equal(stored.account, ACCOUNT);
      assert.equal(stored.credentialId, joined.credential_id);
    });

    for (const [name, x] of [
      ['guardian', g],
      ['holder', h],
      ['recover', r],
    ]) {
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
