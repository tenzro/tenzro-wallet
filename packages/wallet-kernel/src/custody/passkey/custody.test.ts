/**
 * Custody flows against a mocked network and an in-memory authenticator.
 * The keystore lives on the network: every change is a `KeystoreUpdate`
 * sent from the account, signed by one of its passkeys, and its digest is
 * computed here, matching the vector the node and every SDK share.
 */

import { readFileSync } from 'node:fs';

import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { HybridSigner, TypedTransaction } from 'tenzro-sdk';
import { describe, expect, it } from 'vitest';

import { concatBytes, fromHex, toHex, utf8 } from './bytes.ts';
import { SignatureContext, signingDigest, webauthnChallenge } from './composite.ts';
import {
  PasskeyCustody,
  decodeRecoveryApproval,
  decodeRecoveryRequest,
  encodeRecoveryApproval,
  encodeRecoveryRequest,
} from './custody.ts';
import { humanDidFromPasskey, smartAccountAddress } from './derive.ts';
import { FakeAuthenticator } from './fake-authenticator.fixture.ts';
import { custodyChallengeDigest } from './gate.ts';
import { network } from './keystore-network.fixture.ts';
import {
  type KeystoreAnchor,
  type KeystoreCredential,
  type KeystoreOp,
  type KeystoreRecord,
  type KeystoreUpdate,
  keystoreDigest,
  prepareUpdate,
  signKeystoreDigest,
  updateDigest,
  withPossession,
} from './keystore.ts';
import { PasskeyError } from './webauthn.ts';

const vector = JSON.parse(
  readFileSync(new URL('./fixtures/keystore-digest.json', import.meta.url), 'utf8'),
) as {
  account: string;
  previous_commitment: string;
  cases: Array<{ op: unknown; digest: string }>;
};

const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** The challenge a WebAuthn signature in `sig` was made over. */
function challengeOf(sig: { client_data_json: number[] }): string {
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(sig.client_data_json))).challenge;
}

/** Whether the composite JSON signature `sig` is `publicKey`'s WebAuthn assertion. */
function verifies(sig: { classical: Record<string, string> }, publicKey: string): boolean {
  const c = sig.classical;
  const ad = fromHex(c.authenticator_data ?? '');
  const cdj = fromHex(c.client_data_json ?? '');
  return p256.verify(
    fromHex(c.signature ?? ''),
    concatBytes(ad, sha256(cdj)),
    concatBytes(new Uint8Array([4]), fromHex(publicKey)),
    {
      format: 'der',
    },
  );
}

async function wallet(rpId = 'tenzro.com') {
  const auth = new FakeAuthenticator(rpId);
  const net = network();
  const custody = new PasskeyCustody({ rpc: net.rpc, authenticator: auth, sender: net.sender });
  const account = await custody.createWallet({ displayName: 'Ada' });
  return { auth, net, custody, account };
}

describe('the keystore digest', () => {
  it('matches the vector the node and every SDK share', () => {
    expect(vector.cases).toHaveLength(8);
    for (const c of vector.cases) {
      expect(
        toHex(keystoreDigest(vector.account, vector.previous_commitment, c.op as KeystoreOp)),
      ).toBe(c.digest);
    }
  });
});

describe('createWallet', () => {
  it('enrols with this wallet’s relying party and derives the account and identity itself', async () => {
    const { auth, net, account } = await wallet('wallet.example.org');
    const cred = auth.credentials[0]!;
    const [enroll] = net.rpc.paramsOf('tenzro_enrollPasskey');
    expect(enroll?.rp_id).toBe('wallet.example.org');
    expect(account.account).toBe(`0x${toHex(smartAccountAddress(cred.publicKey, cred.id, 0))}`);
    expect(account.did).toBe(humanDidFromPasskey(cred.publicKey));
    expect(account.anchor?.public_key).toBe(toHex(cred.publicKey));
    expect(net.records.size).toBe(0);
  });
});

describe('approveLink', () => {
  /** A passkey another wallet provider made for the account, and the change it prepared. */
  async function providerLink(
    net: Awaited<ReturnType<typeof wallet>>['net'],
    account: Awaited<ReturnType<typeof wallet>>['account'],
  ) {
    const provider = new FakeAuthenticator('tenzro.xyz');
    // Fake keys follow a counter: skip the first so the key differs from this wallet's.
    await provider.create({ userId: fromHex(account.account), userName: 'Labs' });
    const made = await provider.create({ userId: fromHex(account.account), userName: 'Labs' });
    const credential: KeystoreCredential = {
      rp_id: 'tenzro.xyz',
      credential_id: toHex(made.credentialId),
      public_key: toHex(made.publicKey),
      aaguid: '00'.repeat(16),
      backup_eligible: false,
      backup_state: false,
      counts_as_root_from_ms: 0,
      label: 'Labs Wallets',
    };
    const prepared = await prepareUpdate(
      net.rpc,
      account.account,
      { add_credential: { credential } },
      account.anchor,
    );
    const update = withPossession(
      { ...prepared, anchor: null },
      await signKeystoreDigest(provider, prepared, [{ id: credential.credential_id }]),
    );
    return { credential, update };
  }

  it('sends another provider’s prepared link from the account, approved by this device', async () => {
    const { auth, net, custody, account } = await wallet();
    const { credential, update } = await providerLink(net, account);
    const linked = await custody.approveLink(account, update);
    expect(linked.credentials_total).toBe(2);
    const { key, tx } = net.sent[0]!;
    expect(tx.kind).toBe('KeystoreUpdate');
    expect(tx.from).toBe(account.account);
    expect(toHex(key)).toBe(toHex(auth.credentials[0]!.publicKey));
    const sent = (tx.fields as { update: KeystoreUpdate }).update;
    // The wallet supplies the anchor of an account not yet on chain; the proof is the provider's.
    expect(sent.anchor?.credential_id).toBe(account.credentialId);
    expect(sent.possession).toEqual(update.possession);
    const records = net.records.get(account.account.slice(2))?.credentials ?? [];
    expect(records.map((c) => c.rp_id)).toEqual(['tenzro.com', 'tenzro.xyz']);
    expect(records[1]?.credential_id).toBe(credential.credential_id);
  });

  it('refuses anything but a link to this account, unsigned links, and stale ones', async () => {
    const { net, custody, account } = await wallet();
    const { update } = await providerLink(net, account);
    await expect(
      custody.approveLink(account, { ...update, account: `0x${'11'.repeat(20)}` }),
    ).rejects.toThrow(/another account/);
    await expect(
      custody.approveLink(account, {
        ...update,
        op: { set_policy: { policy: 'two_credentials' } },
      }),
    ).rejects.toThrow(/Only linking/);
    await expect(custody.approveLink(account, { ...update, possession: null })).rejects.toThrow(
      /not signed/,
    );
    await expect(
      custody.approveLink(account, { ...update, previous_commitment: `0x${'22'.repeat(32)}` }),
    ).rejects.toThrow(/changed since/);
    expect(net.sent).toHaveLength(0);
  });
});

describe('linkDevice', () => {
  it('sends the change from the account, signed by a linked passkey, with the new passkey’s proof', async () => {
    const { auth, net, custody, account } = await wallet();
    const first = auth.credentials[0]!;
    const linked = await custody.linkDevice({
      account,
      label: 'Phone',
      approver: { id: account.credentialId },
    });
    const added = auth.credentials[1]!;
    expect(added.userId).toEqual(fromHex(account.account));
    expect(linked.credentials_total).toBe(2);

    const { key, tx, signature } = net.sent[0]!;
    expect(tx.kind).toBe('KeystoreUpdate');
    expect(tx.from).toBe(account.account);
    expect(toHex(key)).toBe(toHex(first.publicKey));
    const update = (tx.fields as { update: KeystoreUpdate }).update;
    expect(update.anchor?.credential_id).toBe(account.credentialId);
    const op = update.op as { add_credential: { credential: KeystoreCredential } };
    expect(op.add_credential.credential.rp_id).toBe('tenzro.com');
    expect(op.add_credential.credential.public_key).toBe(toHex(added.publicKey));
    // The new passkey signed the change itself.
    const possession = update.possession as unknown as { classical: Record<string, string> };
    expect(verifies(possession, toHex(added.publicKey))).toBe(true);
    const signed = JSON.parse(
      new TextDecoder().decode(fromHex(possession.classical.client_data_json ?? '')),
    ).challenge;
    expect(signed).toBe(b64url(signingDigest(SignatureContext.AccountOwner, updateDigest(update))));
    // The sender's passkey signed the transaction.
    expect(signature).toBeDefined();
    expect((net.records.get(account.account.slice(2))?.credentials ?? []).length).toBe(2);
  });

  it('never unlinks the last passkey', async () => {
    const { custody, account } = await wallet();
    await expect(
      custody.removeDevice({
        account,
        credentialIdHex: account.credentialId,
        approver: { id: account.credentialId },
      }),
    ).rejects.toMatchObject({ kind: 'last-device' });
  });

  it('lets a linked device unlink the first one', async () => {
    const { auth, net, custody, account } = await wallet();
    await custody.linkDevice({ account, label: 'Phone', approver: { id: account.credentialId } });
    const phone = toHex(auth.credentials[1]!.id);
    const { anchor: _anchor, ...onChain } = account;
    await custody.removeDevice({
      account: onChain,
      credentialIdHex: account.credentialId,
      approver: { id: phone },
    });
    const last = net.sent.at(-1)!;
    expect(toHex(last.key)).toBe(toHex(auth.credentials[1]!.publicKey));
    expect(
      net.records.get(account.account.slice(2))?.credentials.map((c) => c.credential_id),
    ).toEqual([phone]);
  });
});

describe('signIn', () => {
  it('finds a linked device from its credential id on any node', async () => {
    const { auth, custody, account } = await wallet();
    await custody.linkDevice({ account, label: 'Phone', approver: { id: account.credentialId } });
    auth.preferred = toHex(auth.credentials[1]!.id);
    const found = await custody.signIn();
    expect(found.account).toBe(account.account);
    expect(found.did).toBe(account.did);
    expect(found.anchor).toBeUndefined();
  });

  it('derives the account of a first passkey before the keystore is on chain', async () => {
    const { custody, account } = await wallet();
    const found = await custody.signIn();
    expect(found.account).toBe(account.account);
    expect(found.did).toBe(account.did);
    expect(found.anchor?.public_key).toBe(account.anchor?.public_key);
  });
});

describe('acting from a linked device', () => {
  it('signs for the account with the linked device’s own key', async () => {
    const { auth, custody, account } = await wallet();
    await custody.linkDevice({ account, label: 'Phone', approver: { id: account.credentialId } });
    const phone = auth.credentials[1]!;
    const { anchor: _anchor, ...rest } = account;
    const onPhone = { ...rest, credentialId: toHex(phone.id) };
    const signer = await custody.transactionSigner(onPhone);
    expect(toHex(signer.p256PublicKey())).toBe(toHex(phone.publicKey));
  });
});

describe('policy', () => {
  it('moving to two passkeys takes two', async () => {
    const { auth, net, custody, account } = await wallet();
    await custody.linkDevice({ account, label: 'Phone', approver: { id: account.credentialId } });
    const phone = { id: toHex(auth.credentials[1]!.id) };
    const { anchor: _anchor, ...onChain } = account;
    await custody.setSecondFactor({
      account: onChain,
      policy: 'two_credentials',
      approver: { id: account.credentialId },
      second: phone,
    });
    const update = (net.sent.at(-1)!.tx.fields as { update: KeystoreUpdate }).update;
    expect(update.approvals).toHaveLength(1);
    expect(update.approvals[0]?.public_key).toBe(toHex(auth.credentials[1]!.publicKey));
    expect(net.records.get(account.account.slice(2))?.policy).toBe('two_credentials');
  });
});

describe('recovery', () => {
  it('guardians approve the change itself and the joining passkey sends it', async () => {
    const { auth, net, custody, account } = await wallet();
    // A guardian on another device.
    const guardianAuth = new FakeAuthenticator();
    const guardianSide = new PasskeyCustody({
      rpc: net.rpc,
      authenticator: guardianAuth,
      sender: net.sender,
    });
    const card = await guardianSide.createGuardian({ label: 'Backup key', source: 'security_key' });
    await custody.addGuardian({ account, card, approver: { id: account.credentialId } });
    expect(net.records.get(account.account.slice(2))?.recovery_signers).toHaveLength(1);

    // The owner lost every device; a new one starts the recovery.
    const newAuth = new FakeAuthenticator();
    const recovering = new PasskeyCustody({
      rpc: net.rpc,
      authenticator: newAuth,
      sender: net.sender,
    });
    const { credentialId, request } = await recovering.startRecovery({
      account: account.account,
      label: 'New phone',
    });
    const sentBefore = net.sent.length;
    const decoded = decodeRecoveryRequest(encodeRecoveryRequest(request));
    expect(net.sent.length).toBe(sentBefore);

    const approval = decodeRecoveryApproval(
      encodeRecoveryApproval(await guardianSide.approveRecovery(decoded)),
    );
    expect(approval.public_key).toBe(card.p256.replace(/^0x/, ''));
    expect(
      challengeOf({
        client_data_json: Array.from(
          fromHex(
            (approval.signature as unknown as { classical: Record<string, string> }).classical
              .client_data_json ?? '',
          ),
        ),
      }),
    ).toBe(b64url(signingDigest(SignatureContext.RecoveryApproval, updateDigest(request.update))));

    await recovering.submitRecovery({ request: decoded, approvals: [approval], credentialId });
    const sent = net.sent.at(-1)!;
    expect(sent.tx.from?.replace(/^0x/, '')).toBe(account.account.slice(2));
    expect(toHex(sent.key)).toBe(toHex(newAuth.credentials[0]!.publicKey));
    await recovering.finishRecovery({ account: account.account, credentialId });
    expect(
      net.records.get(account.account.slice(2))?.credentials.map((c) => c.credential_id),
    ).toContain(credentialId);
    expect(auth.credentials).toHaveLength(1);
  });

  it('a guardian refuses a request the account has moved past', async () => {
    const { net, custody, account } = await wallet();
    const guardianSide = new PasskeyCustody({
      rpc: net.rpc,
      authenticator: new FakeAuthenticator(),
      sender: net.sender,
    });
    const card = await guardianSide.createGuardian({ label: 'Key', source: 'security_key' });
    await custody.addGuardian({ account, card, approver: { id: account.credentialId } });
    const recovering = new PasskeyCustody({
      rpc: net.rpc,
      authenticator: new FakeAuthenticator(),
      sender: net.sender,
    });
    const { request } = await recovering.startRecovery({ account: account.account, label: 'New' });
    const stale = {
      ...request,
      update: { ...request.update, previous_commitment: '00'.repeat(32) },
    };
    await expect(guardianSide.approveRecovery(stale)).rejects.toBeInstanceOf(PasskeyError);
  });
});

describe('device states', () => {
  it('lists each passkey with its provider, when it joined and where it stands', async () => {
    const { auth, net, custody, account } = await wallet();
    await custody.linkDevice({ account, label: 'Phone', approver: { id: account.credentialId } });
    const key = account.account.replace(/^0x/, '');
    const record = net.records.get(key)!;
    const [first, second] = record.credentials;
    const now = 1_000_000;
    net.records.set(key, {
      ...record,
      credentials: [
        { ...first!, added_at_ms: 500, counts_as_root_from_ms: 0, rp_id: 'tenzro.com' },
        {
          ...second!,
          added_at_ms: 900,
          counts_as_root_from_ms: now + 60_000,
          rp_id: 'wallet.example.org',
        },
      ],
      pending_recovery: {
        credential: {
          ...second!,
          credential_id: 'ee'.repeat(16),
          public_key: '11'.repeat(64),
          label: 'New phone',
        },
        approvers: [0],
        started_at_ms: now,
        ready_at_ms: now + 3_600_000,
      },
    });
    const { anchor: _anchor, ...onChain } = account;
    const devices = await custody.listDevices(onChain, now);
    expect(devices.map((d) => d.status)).toEqual(['on-wallet', 'waiting', 'recovering']);
    expect(devices[0]).toMatchObject({ addedAtMs: 500, rpId: 'tenzro.com' });
    expect(devices[1]).toMatchObject({ rpId: 'wallet.example.org', countsFromMs: now + 60_000 });
    expect(devices[2]).toMatchObject({ label: 'New phone', countsFromMs: now + 3_600_000 });
    expect(auth.credentials.length).toBe(2);
  });
});

describe('a sponsor pays for an account with no balance', () => {
  it('sends the change from its own account, the passkey approving it', async () => {
    const auth = new FakeAuthenticator('tenzro.com');
    const net = network();
    net.rpc.handlers.eth_getBalance = () => '0x0';
    const submitted: KeystoreUpdate[] = [];
    const custody = new PasskeyCustody({
      rpc: net.rpc,
      authenticator: auth,
      sender: net.sender,
      sponsor: {
        async submit(update) {
          submitted.push(update);
          net.apply(update);
          return '0xsponsored';
        },
      },
    });
    const account = await custody.createWallet({ displayName: 'Ada' });
    await custody.linkDevice({ account, label: 'Phone', approver: { id: account.credentialId } });
    expect(net.sent).toHaveLength(0);
    expect(submitted).toHaveLength(1);
    const [update] = submitted;
    expect(update!.approvals.map((a) => a.public_key)).toEqual([
      toHex(auth.credentials[0]!.publicKey),
    ]);
    expect(update!.possession).not.toBeNull();
  });

  it('a funded account pays for itself', async () => {
    const auth = new FakeAuthenticator('tenzro.com');
    const net = network();
    net.rpc.handlers.eth_getBalance = () => '0x1';
    const custody = new PasskeyCustody({
      rpc: net.rpc,
      authenticator: auth,
      sender: net.sender,
      sponsor: { submit: async () => expect.unreachable('the account pays') },
    });
    const account = await custody.createWallet({ displayName: 'Ada' });
    await custody.linkDevice({ account, label: 'Phone', approver: { id: account.credentialId } });
    expect(net.sent).toHaveLength(1);
  });
});
