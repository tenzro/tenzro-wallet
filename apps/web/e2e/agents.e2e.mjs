/**
 * Browser test of the agent, publisher and settlement-plan screens against a
 * built wallet and a mocked node. Chromium's virtual WebAuthn authenticator
 * (CDP) holds the account passkey, so each approval is a real
 * navigator.credentials call, and every signature the mock node receives is
 * verified as the node verifies it.
 *
 * Covers: an agent's Terms in TNZO with a USD estimate; raising its limits,
 * which first tops its bond up to a tenth of the new ceiling; adding to and
 * withdrawing the bond; revoking it with the passkey; publisher mode (standing split, preview, setting it with a
 * passkey-signed Payment transaction, payouts); and the plan review a site
 * asks for before the passkey signs a settlement plan's open transaction.
 *
 * Needs the app built with NEXT_PUBLIC_TENZRO_RP_ID=localhost and
 * NEXT_PUBLIC_TENZRO_RPC_URL=http://rpc.test.invalid/ and
 * NEXT_PUBLIC_TENZRO_CHAIN_ID=1337, and served at BASE_URL.
 * Run: `node e2e/agents.e2e.mjs`.
 */

import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, verify } from 'node:crypto';

import { chromium } from 'playwright';
import {
  TRANSACTION_SIGNATURE_CONTEXT,
  compositeMessageRepresentative,
  previewSplit as localPreview,
} from 'tenzro-sdk';
import { agentTermsTarget } from 'tenzro-wallet';
import {
  SignatureContext,
  agentActionDigest,
  agentWalletAccount,
  custodyChallengeDigest,
  hexToBytes,
  humanDidFromPasskey,
  webauthnChallenge,
} from 'tenzro-wallet/custody';

const BASE = process.env.BASE_URL ?? 'http://localhost:3917';
const RPC = 'http://rpc.test.invalid/';
const ACCOUNT = `0x${'ac'.repeat(20)}`;
/** The account in its 32-byte ledger slot: what transactions name as `from` and payments pay. */
const ACCOUNT_SLOT = `${ACCOUNT}${'00'.repeat(12)}`;
const TNZO = 10n ** 18n;
/** The identity the account passkey derives; set once the key exists. */
let HUMAN = '';
const AGENT = 'did:tenzro:machine:e2e:shopper';
const RATE_NANO_USD = '2500000000'; // 2.50 USD per TNZO
const FEE_PARAMS = { fee_bps: 30, min_fee: '0', burn_bps: 5000, insurance_bps: 1000 };

const hex = (b) => `0x${Buffer.from(b).toString('hex')}`;
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
  const key = createPublicKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: xy.subarray(0, 32).toString('base64url'),
      y: xy.subarray(32).toString('base64url'),
    },
  });
  const signed = Buffer.concat([
    ad,
    createHash('sha256').update(Buffer.from(clientDataJson)).digest(),
  ]);
  assert.ok(verify('sha256', signed, key, Buffer.from(signature)), `${what}: signature`);
}

/** The challenge a passkey signs for a transaction digest: base64url(SHA-256(M')). */
async function txChallenge(digestHex) {
  const mPrime = await compositeMessageRepresentative(
    TRANSACTION_SIGNATURE_CONTEXT,
    hexToBytes(digestHex),
  );
  return b64u(createHash('sha256').update(mPrime).digest());
}

function mockNode(accountKey, credId) {
  const calls = [];
  const challenges = new Map();
  const payloads = new Map();
  let n = 0;
  const node = {
    calls,
    revoked: false,
    split: null,
    sent: [],
    bond: 2n * TNZO,
    bondState: 'Active',
  };
  node.terms = {
    controller_did: HUMAN,
    agent_name: 'shopper',
    delegation_scope: {
      max_transaction_value: '4000000000000000000',
      max_daily_spend: '20000000000000000000',
      allowed_operations: ['pay', 'settlement_plan'],
      allowed_chains: ['tenzro', 'base'],
      max_split_fee_bps: 150,
    },
    serving_nodes: [],
  };
  const handlers = {
    eth_chainId: () => '0x539',
    eth_gasPrice: () => '0x3b9aca00',
    tenzro_listRoleEndpoints: () => ({ endpoints: [] }),
    tenzro_getCheckpointCertificate: () => ({ index: 1, digest: 'cd'.repeat(32) }),
    tenzro_getNonce: () => '0x7',
    tenzro_resolveIdentity: () => ({
      record: { identity_data: { Human: { controlled_machines: [AGENT] } } },
    }),
    tenzro_getAgentTerms: (p) => {
      assert.equal(p.agent_did, AGENT);
      return {
        agent_did: AGENT,
        root_kind: 'passkey',
        status: node.revoked ? 'revoked' : 'active',
        version: 2,
        approval_digest: 'ab'.repeat(32),
        updated_at_ms: 1,
        terms: node.terms,
        spent: {
          today: '6000000000000000000',
          this_hour: '0',
          actions_today: 3,
          actions_this_hour: 0,
          remaining_today: '14000000000000000000',
          remaining_this_hour: null,
          assets: [],
        },
      };
    },
    tenzro_getAgentBond: (p) => {
      assert.equal(p.agent_did, AGENT);
      return {
        amount: node.bond.toString(),
        state: node.bondState,
        cooldown_until_ms: null,
        vault: 'cd'.repeat(20),
      };
    },
    tenzro_updateAgentTerms: (p) => {
      const c = challenges.get(p.authorization.challenge_id);
      assert.ok(c, 'terms: a challenge the node issued');
      assert.equal(c.operation, 'update_agent_terms');
      assert.equal(p.agent_did, AGENT);
      const a = p.authorization.assertion;
      verifyAssertion(
        {
          authenticatorData: a.authenticator_data,
          clientDataJson: a.client_data_json,
          signature: a.signature,
        },
        accountKey.xy,
        webauthnChallenge(SignatureContext.AccountOwner, c.digest),
        'terms',
      );
      node.terms = p.delegation;
      return { agent_did: AGENT, delegation: p.delegation, tokens_revoked: 0 };
    },
    tenzro_getFeeRate: () => ({ rate_nano_usd: RATE_NANO_USD, mode: 'oracle' }),
    tenzro_getKeystore: (p) => {
      assert.equal(p.account.replace(/^0x/, ''), ACCOUNT.slice(2), 'keystore of the account');
      return {
        account: ACCOUNT.slice(2),
        on_chain: true,
        commitment: 'ef'.repeat(32),
        independent_roots: 1,
        may_spend: true,
        keystore: {
          account: ACCOUNT.slice(2),
          owner_did: HUMAN,
          salt: 0,
          version: 1,
          credentials: [
            {
              rp_id: 'localhost',
              credential_id: credId.toString('hex'),
              public_key: accountKey.xy.toString('hex'),
              aaguid: '00'.repeat(16),
              backup_eligible: false,
              backup_state: false,
              counts_as_root_from_ms: 0,
              label: 'This device',
            },
          ],
          policy: 'single_credential',
          recovery_signers: [],
          recovery_threshold: 0,
          pending_recovery: null,
        },
      };
    },
    tenzro_resolveCredential: (p) => ({
      accounts:
        p.credential_id.replace(/^0x/, '') === credId.toString('hex') ? [ACCOUNT.slice(2)] : [],
    }),
    tenzro_getPayeeSplit: () => ({ rule: node.split }),
    tenzro_listPayments: (p) => ({
      payments: [
        {
          cursor: '1',
          tx_hash: `0x${'12'.repeat(32)}`,
          record: { amount: '3000000000000000000', payee: p.payee },
        },
      ],
      cursor: null,
    }),
    tenzro_previewSplit: (p) => ({
      allocation: localPreview(BigInt(p.gross), p.split, FEE_PARAMS, BigInt(p.network_fees ?? '0')),
      split_hash: '00',
    }),
    tenzro_createCustodyChallenge: (p) => {
      n += 1;
      const nonce = randomBytes(16);
      const target =
        p.operation === 'update_agent_terms'
          ? agentTermsTarget(p.delegation, p.rotate_tokens)
          : hexToBytes(p.target_hex ?? '0x');
      const digest = custodyChallengeDigest(
        hexToBytes(p.account_address),
        p.operation,
        target,
        nonce,
      );
      challenges.set(`c${n}`, { ...p, digest });
      return {
        challenge_id: `c${n}`,
        challenge_hex: hex(digest),
        webauthn_challenge: webauthnChallenge(SignatureContext.AccountOwner, digest),
        nonce_hex: hex(nonce),
        target_hex: hex(target),
        expires_in_secs: 300,
        ...(p.delegation ? { delegation: p.delegation } : {}),
      };
    },
    tenzro_revokeIdentity: (p) => {
      const c = challenges.get(p.authorization.challenge_id);
      assert.ok(c, 'revoke: a challenge the node issued');
      assert.equal(c.operation, 'revoke_delegated_agent');
      assert.equal(
        Buffer.from(hexToBytes(c.target_hex)).toString('utf8'),
        AGENT,
        'revoke: target is the agent DID',
      );
      assert.equal(p.did, AGENT);
      const a = p.authorization.assertion;
      verifyAssertion(
        {
          authenticatorData: a.authenticator_data,
          clientDataJson: a.client_data_json,
          signature: a.signature,
        },
        accountKey.xy,
        webauthnChallenge(SignatureContext.AccountOwner, c.digest),
        'revoke',
      );
      node.revoked = true;
      return { tokens_revoked: 1, chain: { submitted: true, tx_hash: '0x01' } };
    },
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
    tenzro_sendRawTransaction: (p) => {
      node.sent.push(p);
      if (p.tx_type?.Payment?.op?.set_split) node.split = p.tx_type.Payment.op.set_split.rule;
      const bond = p.tx_type?.IncreaseAgentBond ?? p.tx_type?.PostAgentBond;
      if (bond) {
        node.bond += BigInt(String(bond.amount));
        node.bondState = 'Active';
      }
      if (p.tx_type?.WithdrawAgentBond) node.bondState = 'Cooldown';
      return `0x${'34'.repeat(32)}`;
    },
  };
  node.answer = (method, params) => {
    calls.push({ method, params });
    const h = handlers[method];
    if (!h) throw new Error(`unmocked ${method}`);
    return h(params);
  };
  node.payloads = payloads;
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
      payload = { jsonrpc: '2.0', id: body.id, result: node.answer(body.method, body.params) };
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

/** Checks a passkey-signed transaction the way the node does: the WebAuthn leg over the payload digest. */
async function verifyTx(node, sent, xy, what) {
  const sig = sent.signature.classical;
  assert.equal(sig.form, 'web_authn', `${what}: passkey form`);
  assert.equal(sent.public_key, xy.toString('hex'), `${what}: public key`);
  assert.equal(sent.from, ACCOUNT_SLOT, `${what}: from the wallet's account`);
  const digest = [...node.payloads.keys()].find(
    (d) => node.payloads.get(d).timestamp === sent.timestamp,
  );
  assert.ok(digest, `${what}: a payload the node issued`);
  verifyAssertion(
    {
      authenticatorData: Buffer.from(sig.authenticator_data, 'hex'),
      clientDataJson: Buffer.from(sig.client_data_json, 'hex'),
      signature: Buffer.from(sig.signature, 'hex'),
    },
    xy,
    await txChallenge(digest),
    what,
  );
}

async function main() {
  const browser = await chromium.launch();
  let passed = 0;
  const step = async (name, fn) => {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  };
  try {
    const accountKey = randomP256();
    HUMAN = humanDidFromPasskey(accountKey.xy);
    const credId = randomBytes(16);
    const node = mockNode(accountKey, credId);
    const ctx = await browser.newContext();
    await withNode(ctx, node);
    await ctx.addInitScript(
      ([account, credentialId, did, origin]) => {
        // A popup starts as about:blank, whose opaque origin has no storage.
        if (location.origin !== origin) return;
        if (!localStorage.getItem('tenzro.wallet.v2')) {
          localStorage.setItem(
            'tenzro.wallet.v2',
            JSON.stringify({
              did,
              account,
              credentialId,
              transports: ['internal'],
              tier: 'device-bound',
            }),
          );
          localStorage.setItem(
            'tenzro.wallet.connections.v1',
            JSON.stringify([{ origin, account, connectedAt: Date.now() }]),
          );
        }
      },
      [ACCOUNT, credId.toString('hex'), HUMAN, new URL(BASE).origin],
    );
    const errors = [];
    ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(String(e))));
    /** Gives `p` a virtual platform authenticator holding the account passkey. */
    const holdPasskey = async (p) => {
      const cdp = await ctx.newCDPSession(p);
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
          credentialId: credId.toString('base64'),
          isResidentCredential: true,
          rpId: 'localhost',
          privateKey: accountKey.pkcs8.toString('base64'),
          userHandle: Buffer.from(ACCOUNT.slice(2), 'hex').toString('base64'),
          signCount: 0,
        },
      });
    };
    const page = await ctx.newPage();
    await holdPasskey(page);

    await step('agents: Terms in TNZO with a labelled USD estimate', async () => {
      await page.goto(`${BASE}/agents`);
      const card = page.locator(`[data-agent="${AGENT}"]`);
      await card.waitFor();
      const text = await card.innerText();
      assert.match(text, /shopper/);
      assert.match(text, /Passkey/);
      assert.match(text, /Per payment\s*4 TNZO \(about \$10\.00\)/);
      assert.match(text, /Per day\s*20 TNZO \(about \$50\.00\)/);
      assert.match(text, /Spent today\s*6 TNZO \(about \$15\.00\)/);
      assert.match(text, /Left today\s*14 TNZO/);
      assert.match(text, /at most 1\.50%/);
      assert.match(text, /estimates at the network's current TNZO rate/);
      assert.match(text, /Bond\s*2 TNZO \(about \$5\.00\)/);
    });

    await step(
      'agents: higher limits top the bond up first, then the passkey approves the Terms',
      async () => {
        const card = page.locator(`[data-agent="${AGENT}"]`);
        await card.getByRole('button', { name: 'Change limits' }).click();
        await card.getByLabel('Per day, TNZO').fill('30');
        await card.getByRole('button', { name: 'Approve new limits' }).click();
        await card.getByText(/Per day\s*30 TNZO/).waitFor({ timeout: 30_000 });
        assert.equal(node.terms.delegation_scope.max_daily_spend, '30000000000000000000');
        assert.equal(node.terms.delegation_scope.max_transaction_value, '4000000000000000000');
        assert.equal(node.calls.filter((c) => c.method === 'tenzro_updateAgentTerms').length, 1);
        const topUps = node.sent.filter((t) => t.tx_type?.IncreaseAgentBond);
        assert.equal(topUps.length, 1, 'one bond top-up');
        assert.equal(topUps[0].tx_type.IncreaseAgentBond.agent_did, AGENT);
        assert.equal(
          BigInt(String(topUps[0].tx_type.IncreaseAgentBond.amount)),
          1n * TNZO,
          'up to a tenth of 30 TNZO',
        );
        const sentAt = node.calls.findIndex((c) => c.method === 'tenzro_sendRawTransaction');
        const termsAt = node.calls.findIndex((c) => c.method === 'tenzro_updateAgentTerms');
        assert.ok(sentAt < termsAt, 'the bond is posted before the Terms are recorded');
        await verifyTx(node, topUps[0], accountKey.xy, 'bond top-up');
        assert.equal(node.bond, 3n * TNZO);
      },
    );

    await step('agents: lowering limits posts no bond', async () => {
      const before = node.sent.length;
      const card = page.locator(`[data-agent="${AGENT}"]`);
      await card.getByRole('button', { name: 'Change limits' }).click();
      await card.getByLabel('Per day, TNZO').fill('25');
      await card.getByRole('button', { name: 'Approve new limits' }).click();
      await card.getByText(/Per day\s*25 TNZO/).waitFor({ timeout: 30_000 });
      assert.equal(node.sent.length, before, 'no transaction');
    });

    await step('agents: bond topped up and withdrawn with the passkey', async () => {
      const card = page.locator(`[data-agent="${AGENT}"]`);
      await card.getByLabel('Add to bond').fill('0.5');
      await card.getByRole('button', { name: 'Add', exact: true }).click();
      await card.getByText(/Bond\s*3\.5 TNZO/).waitFor({ timeout: 30_000 });
      const added = node.sent.at(-1);
      assert.equal(BigInt(String(added.tx_type.IncreaseAgentBond.amount)), TNZO / 2n);
      await verifyTx(node, added, accountKey.xy, 'bond add');
      await card.getByRole('button', { name: 'Withdraw the bond (stops the agent)' }).click();
      await card.getByRole('button', { name: 'Return the bond' }).waitFor({ timeout: 30_000 });
      const withdrawn = node.sent.at(-1);
      assert.equal(withdrawn.tx_type.WithdrawAgentBond.agent_did, AGENT);
      await verifyTx(node, withdrawn, accountKey.xy, 'bond withdraw');
      node.bondState = 'Active';
    });

    await step('agents: a held action approved for exactly the action shown', async () => {
      const action = {
        agent_did: AGENT,
        machine_did: 'did:tenzro:machine:serving-a',
        operation: 'pay',
        counterparty: 'ab'.repeat(20),
        amount: '5000000000000000000',
        chain: 'tenzro',
        nonce: 3,
      };
      const nonce = randomBytes(16);
      const target = agentActionDigest(action);
      const account = agentWalletAccount(AGENT);
      const digest = custodyChallengeDigest(account, 'agent_step_up', target, nonce);
      const stepUp = {
        controller_operation: 'agent_step_up',
        account: Buffer.from(account).toString('hex'),
        nonce: nonce.toString('hex'),
        target: Buffer.from(target).toString('hex'),
        challenge_hex: Buffer.from(digest).toString('hex'),
        webauthn_challenge: webauthnChallenge(SignatureContext.AccountOwner, digest),
        action_nonce: 3,
      };
      await page
        .getByLabel('Held action')
        .fill(JSON.stringify({ action, step_up: { step_up: stepUp } }));
      await page.getByRole('button', { name: 'Review' }).click();
      await page.getByText('5 TNZO', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Approve this action' }).click();
      const out = page.getByLabel('Step-up approval');
      await out.waitFor({ timeout: 30_000 });
      const approval = JSON.parse(await out.inputValue());
      assert.equal(approval.account, stepUp.account);
      assert.equal(approval.nonce, stepUp.nonce);
      assert.equal(approval.root_public_key, accountKey.xy.toString('hex'));
      const c = approval.signature.classical;
      assert.equal(c.form, 'web_authn');
      verifyAssertion(
        {
          authenticatorData: Buffer.from(c.authenticator_data, 'hex'),
          clientDataJson: Buffer.from(c.client_data_json, 'hex'),
          signature: Buffer.from(c.signature, 'hex'),
        },
        accountKey.xy,
        stepUp.webauthn_challenge,
        'step-up',
      );
    });

    await step('agents: one revoke, approved with the passkey', async () => {
      const card = page.locator(`[data-agent="${AGENT}"]`);
      await card.getByRole('button', { name: 'Revoke', exact: true }).click();
      await card.getByRole('button', { name: 'Revoke with passkey' }).click();
      await card.getByText('Revoked', { exact: true }).waitFor({ timeout: 30_000 });
      assert.ok(node.revoked);
      assert.equal(node.calls.filter((c) => c.method === 'tenzro_revokeIdentity').length, 1);
    });

    let payee = '';
    await step('publisher: no split yet, payouts listed', async () => {
      await page.goto(`${BASE}/publisher`);
      await page.getByTestId('current-split').getByText('No split').waitFor();
      await page.getByTestId('payouts').getByText('3 TNZO').waitFor();
      payee = ACCOUNT_SLOT;
      const listed = node.calls.find((c) => c.method === 'tenzro_listPayments');
      assert.equal(listed.params.payee, payee, "payouts read for the wallet's account");
    });

    await step(
      'publisher: previews and sets a split with a passkey-signed transaction',
      async () => {
        await page.getByRole('button', { name: 'Add a share' }).click();
        await page.getByLabel('Role 1').selectOption('referrer');
        await page.getByLabel('Recipient 1').fill(`0x${'bb'.repeat(32)}`);
        await page.getByLabel('Percent 1').fill('10');
        const preview = page.getByTestId('split-preview');
        await preview.waitFor();
        assert.match(await preview.innerText(), /referrer: 0\.0997 TNZO/);
        await page.getByRole('button', { name: 'Set split with passkey' }).click();
        await page
          .getByTestId('current-split')
          .getByText(/referrer: 10% to/)
          .waitFor({ timeout: 30_000 });
        const sent = node.sent.at(-1);
        assert.deepEqual(
          sent.tx_type.Payment.op.set_split.rule.lines.map((l) => l.role),
          ['referrer', 'payee'],
        );
        assert.equal(
          sent.tx_type.Payment.op.set_split.rule.lines[1].recipient.address,
          payee.slice(2),
        );
        await verifyTx(node, sent, accountKey.xy, 'set split');
      },
    );

    await step(
      'plan review: legs, fees, split, commit and abort, then the passkey signs',
      async () => {
        const plan = {
          nonce: 1,
          quote_digest: '09'.repeat(32),
          split_hash: '00'.repeat(32),
          split: {
            version: 1,
            lines: [
              { role: 'facilitator', recipient: { address: 'cc'.repeat(32) }, basis: { bps: 100 } },
              { role: 'payee', recipient: { address: 'dd'.repeat(32) }, basis: 'remainder' },
            ],
          },
          legs: [
            {
              kind: { native_transfer: { amount: '2000000000000000000', escrow_id: null } },
              class_required: 'native',
            },
            {
              kind: { intent_fill: { order_id: 'ee'.repeat(32) } },
              class_required: 'proven',
              usd_e6: 5_000_000,
              max_network_fee: '10000000000000000',
            },
          ],
          decide_deadline_ms: Date.now() + 600_000,
        };
        await page.goto(`${BASE}/agents`);
        const popupPromise = ctx.waitForEvent('page');
        await page.evaluate((p) => {
          window.__resp = null;
          const w = window.open('/approve', 'tenzro-approve', 'width=420,height=720');
          window.addEventListener('message', (e) => {
            if (e.data?.type === 'ready') {
              w.postMessage(
                {
                  protocol: 'tenzro-wallet/popup/v1',
                  type: 'request',
                  id: 'r1',
                  method: 'tenzro_signSettlementPlan',
                  params: { plan: p },
                },
                '*',
              );
            }
            if (e.data?.type === 'response') window.__resp = e.data;
          });
        }, plan);
        const popup = await popupPromise;
        await holdPasskey(popup);
        const review = popup.getByTestId('plan-review');
        await review.waitFor();
        const legs = popup.getByTestId('plan-leg');
        assert.equal(await legs.count(), 2);
        assert.match(await legs.nth(0).innerText(), /2 TNZO from your account on Tenzro/);
        assert.match(await legs.nth(1).innerText(), /proven from its network, \$5\.00/);
        await popup.getByTestId('plan-split').getByText('TNZO').first().waitFor();
        const text = await review.innerText();
        assert.match(text, /Protocol fee: 0\.006 TNZO/);
        assert.match(text, /Network fees, at most: 0\.01 TNZO/);
        assert.match(text, /facilitator \(0xcccc/);
        assert.match(text, /Commit:/);
        assert.match(text, /Abort: if any leg fails or the deadline passes/);
        assert.match(text, /about \$5\.00 for the TNZO, an estimate/);
        await popup.getByRole('button', { name: 'Approve' }).click();
        await page.waitForFunction(() => window.__resp !== null, null, { timeout: 30_000 });
        const resp = await page.evaluate(() => window.__resp);
        const signed = resp.result.signedTx;
        assert.deepEqual(signed.transaction.tx_type.SettlementPlan.op.open, plan);
        const sent = {
          ...signed,
          from: hex(signed.transaction.from),
          timestamp: signed.transaction.timestamp,
        };
        await verifyTx(node, sent, accountKey.xy, 'plan open');
      },
    );

    await step(
      "link: another provider's passkey, approved here and sent from the account",
      async () => {
        const joining = {
          rp_id: 'tenzro.xyz',
          credential_id: '4c'.repeat(16),
          public_key: randomP256().xy.toString('hex'),
          aaguid: '00'.repeat(16),
          backup_eligible: false,
          backup_state: false,
          counts_as_root_from_ms: 0,
          label: 'Labs Wallets',
        };
        const possession = {
          classical: {
            form: 'web_authn',
            authenticator_data: '01',
            client_data_json: '02',
            signature: '03',
          },
        };
        const update = {
          account: ACCOUNT,
          anchor: null,
          previous_commitment: 'ef'.repeat(32),
          op: { add_credential: { credential: joining } },
          approvals: [],
          possession,
        };
        await page.goto(`${BASE}/agents`);
        const popupPromise = ctx.waitForEvent('page');
        await page.evaluate((u) => {
          window.__resp = null;
          const w = window.open('/approve', 'tenzro-approve', 'width=420,height=720');
          window.addEventListener('message', (e) => {
            if (e.data?.type === 'ready') {
              w.postMessage(
                {
                  protocol: 'tenzro-wallet/popup/v1',
                  type: 'request',
                  id: 'r2',
                  method: 'tenzro_linkCredential',
                  params: { update: u },
                },
                '*',
              );
            }
            if (e.data?.type === 'response') window.__resp = e.data;
          });
        }, update);
        const popup = await popupPromise;
        await holdPasskey(popup);
        await popup.getByText('Link a passkey to your wallet?').waitFor();
        await popup.getByText('tenzro.xyz').waitFor();
        const before = node.sent.length;
        await popup.getByRole('button', { name: 'Approve' }).click();
        await page.waitForFunction(() => window.__resp !== null, null, { timeout: 30_000 });
        const resp = await page.evaluate(() => window.__resp);
        assert.equal(resp.error, undefined, JSON.stringify(resp.error));
        assert.equal(resp.result.credentialsTotal, 2);
        assert.equal(node.sent.length, before + 1, 'one transaction');
        const sent = node.sent.at(-1);
        const change = sent.tx_type.KeystoreUpdate.update;
        // Sent as the network encodes it: added_at_ms is the chain's, zero here.
        assert.deepEqual(change.op.add_credential.credential, { ...joining, added_at_ms: 0 });
        assert.deepEqual(change.possession, possession, "the provider's proof, unchanged");
        assert.deepEqual(change.approvals, []);
        await verifyTx(node, sent, accountKey.xy, 'link');
      },
    );

    assert.deepEqual(errors, [], 'page errors');
    console.log(`\n${passed} passed`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
