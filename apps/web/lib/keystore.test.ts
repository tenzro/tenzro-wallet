import {
  type KeystoreCredential,
  type KeystoreOp,
  type KeystoreRecord,
  type KeystoreUpdate,
  type KeystoreView,
  RECOVERY_APPROVAL_SIGNATURE_CONTEXT,
  keystoreDigest,
  passkeyChallenge,
} from 'tenzro-sdk';
import { describe, expect, it, vi } from 'vitest';

import type { Wallet } from './account';
import {
  type Sender,
  approvalsNeeded,
  approveRecovery,
  change,
  coApprove,
  decodeInvite,
  decodeRequest,
  decodeSigner,
  describe as describeOp,
  encodeInvite,
  encodeRequest,
  encodeSigner,
  linkRequest,
  networkSender,
  recoveryRequest,
  relay,
  roots,
  setRecoveryOp,
} from './keystore';
import { type Passkey, PasskeySigner, createPasskey, keystoreCredential } from './passkey';
import { SoftAuthenticator, scriptedRpc, verifies } from './testing';

const RP = 'wallet.example';
const ACCOUNT = `0x${'ab'.repeat(20)}`;
const COMMITMENT = `0x${'cc'.repeat(32)}`;
const NOW = 1_800_000_000_000;

async function device(label: string, api = new SoftAuthenticator()) {
  const c = await createPasskey({ rpId: RP, rpName: 'Example', userName: 'alex', label }, api);
  const { registrationAuthenticatorData: _, ...passkey } = c;
  return { passkey, api, signer: new PasskeySigner(passkey, api) };
}

function credential(p: Passkey, rootFrom = 0): KeystoreCredential {
  return { ...keystoreCredential(p), counts_as_root_from_ms: rootFrom };
}

function record(
  credentials: KeystoreCredential[],
  extra: Partial<KeystoreRecord> = {},
): KeystoreRecord {
  return {
    account: ACCOUNT,
    owner_did: 'did:tenzro:human:alex',
    salt: 0,
    version: 1,
    credentials,
    policy: 'single_credential',
    recovery_signers: [],
    recovery_threshold: 0,
    pending_recovery: null,
    recovery_code: null,
    ...extra,
  };
}

function view(rec: KeystoreRecord, independent: number): KeystoreView {
  return {
    account: ACCOUNT,
    on_chain: true,
    keystore: rec,
    commitment: COMMITMENT,
    independent_roots: independent,
    may_spend: independent >= 2,
  };
}

function chain(v: KeystoreView) {
  return scriptedRpc({ tenzro_getKeystore: () => v });
}

function walletOf(p: Passkey): Wallet {
  return { account: ACCOUNT, did: 'did:tenzro:human:alex', passkey: p, anchor: null };
}

function recordingSender() {
  const fromAccount = vi.fn(async (_u: KeystoreUpdate, _s: unknown, _a: string) => '0xsent');
  const sponsored = vi.fn(async (_u: KeystoreUpdate) => '0xsponsored');
  return { sender: { fromAccount, sponsored } as Sender, fromAccount, sponsored };
}

describe('approvals the wallet asks for', () => {
  const now = NOW;
  const root = (rootFrom = 0) => ({
    ...credential({
      rpId: RP,
      credentialId: '01',
      publicKey: '02'.repeat(64),
      aaguid: '',
      backupEligible: false,
      backupState: false,
      label: 'x',
    }),
    counts_as_root_from_ms: rootFrom,
  });

  it('one passkey for everyday changes, two for high-risk ones once there are two roots', () => {
    const one = view(record([root()]), 1);
    const two = view(record([root(), { ...root(), credential_id: '03' }]), 2);
    const highRisk: KeystoreOp[] = [
      { set_policy: { policy: 'two_credentials' } },
      { set_recovery: { signers: [], threshold: 0 } },
      { set_recovery_code: { commitment: null } },
      { remove_credential: { credential_id: '03' } },
    ];
    for (const op of highRisk) {
      expect(approvalsNeeded(op, one, now)).toBe(1);
      expect(approvalsNeeded(op, two, now)).toBe(2);
    }
    expect(approvalsNeeded('cancel_recovery', two, now)).toBe(1);
  });

  it('any one passkey cancels a device still in its waiting period', () => {
    const v = view(record([root(), { ...root(now + 1000), credential_id: '04' }]), 2);
    expect(approvalsNeeded({ remove_credential: { credential_id: '04' } }, v, now)).toBe(1);
  });

  it('the two-passkey policy asks two for every change except cancelling a recovery', () => {
    const v = view(record([root()], { policy: 'two_credentials' }), 2);
    expect(approvalsNeeded({ add_credential: { credential: root() } }, v, now)).toBe(2);
    expect(approvalsNeeded('cancel_recovery', v, now)).toBe(1);
  });

  it('asks for a second independent root until there is one', () => {
    expect(roots(view(record([root()]), 1)).needsSecond).toBe(true);
    expect(roots(view(record([root()]), 2)).needsSecond).toBe(false);
  });
});

describe('sending changes', () => {
  it('sends from the funded account without a separate approval of the sender', async () => {
    const a = await device('Laptop');
    const { rpc } = chain(view(record([credential(a.passkey)]), 1));
    const { sender, fromAccount, sponsored } = recordingSender();
    const out = await change(
      rpc,
      sender,
      walletOf(a.passkey),
      a.signer,
      'cancel_recovery',
      5n,
      NOW,
    );
    expect(out).toEqual({ sent: '0xsent' });
    expect(sponsored).not.toHaveBeenCalled();
    const [update, , from] = fromAccount.mock.calls[0]!;
    expect(from).toBe(ACCOUNT);
    expect(update.approvals).toHaveLength(0);
    expect(update.previous_commitment).toBe(COMMITMENT);
  });

  it('has the sponsor pay for an empty account, carrying the passkey approval', async () => {
    const a = await device('Laptop');
    const { rpc } = chain(view(record([credential(a.passkey)]), 1));
    const { sender, fromAccount, sponsored } = recordingSender();
    await change(rpc, sender, walletOf(a.passkey), a.signer, 'cancel_recovery', 0n, NOW);
    expect(fromAccount).not.toHaveBeenCalled();
    const update = sponsored.mock.calls[0]![0];
    expect(update.approvals).toHaveLength(1);
    expect(update.approvals[0]!.public_key).toBe(a.passkey.publicKey);
    expect(await verifies(a.passkey.publicKey, a.api.assertions[0]!)).toBe(true);
  });

  it('routes a high-risk change through a second passkey, which then sends it', async () => {
    const shared = new SoftAuthenticator();
    const a = await device('Laptop', shared);
    const b = await device('Phone', shared);
    const v = view(record([credential(a.passkey), credential(b.passkey)]), 2);
    const { rpc } = chain(v);
    const { sender, fromAccount } = recordingSender();
    const op: KeystoreOp = { set_policy: { policy: 'two_credentials' } };
    const out = await change(rpc, sender, walletOf(a.passkey), a.signer, op, 5n, NOW);
    if (!('request' in out)) throw new Error('expected a request');
    expect(fromAccount).not.toHaveBeenCalled();
    const req = decodeRequest(out.request);
    expect(req.kind).toBe('approve');
    expect(req.update.approvals.map((x) => x.public_key)).toEqual([a.passkey.publicKey]);

    await expect(
      coApprove(rpc, sender, walletOf(a.passkey), a.signer, req, 5n, NOW),
    ).rejects.toThrow(/already approved/);
    const sent = await coApprove(rpc, sender, walletOf(b.passkey), b.signer, req, 5n, NOW);
    expect(sent).toEqual({ sent: '0xsent' });
    expect(fromAccount.mock.calls[0]![0].approvals).toHaveLength(1);
  });

  it('refuses a request for another account or made before the account changed', async () => {
    const a = await device('Laptop');
    const b = await device('Phone');
    const { rpc } = chain(view(record([credential(a.passkey), credential(b.passkey)]), 2));
    const { sender } = recordingSender();
    const update: KeystoreUpdate = {
      account: ACCOUNT,
      anchor: null,
      previous_commitment: `0x${'99'.repeat(32)}`,
      op: 'cancel_recovery',
      approvals: [],
      possession: null,
    };
    await expect(
      coApprove(rpc, sender, walletOf(b.passkey), b.signer, { kind: 'approve', update }, 1n, NOW),
    ).rejects.toThrow(/changed since/);
    await expect(
      coApprove(
        rpc,
        sender,
        { ...walletOf(b.passkey), account: `0x${'ef'.repeat(20)}` },
        b.signer,
        { kind: 'approve', update },
        1n,
        NOW,
      ),
    ).rejects.toThrow(/another account/);
  });

  it('the sponsor gets only the change, and is required for an empty account', async () => {
    const update = { account: ACCOUNT } as KeystoreUpdate;
    const { rpc } = scriptedRpc({});
    await expect(networkSender(rpc, undefined).sponsored(update)).rejects.toThrow(/no sponsor/);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tx_hash: '0x1' })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await networkSender(rpc, 'https://sponsor.example/pay').sponsored(update)).toBe('0x1');
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://sponsor.example/pay');
    expect(JSON.parse(init.body as string)).toEqual({ update });
    vi.unstubAllGlobals();
  });
});

describe('linking a device', () => {
  it('the new device proves possession of its passkey over the change', async () => {
    const a = await device('Laptop');
    const n = await device('Phone');
    const v = view(record([credential(a.passkey)]), 1);
    const { rpc } = chain(v);
    const invite = decodeInvite(encodeInvite({ account: ACCOUNT, anchor: null }));
    const code = await linkRequest(rpc, invite, keystoreCredential(n.passkey), n.signer);
    const req = decodeRequest(code);
    expect(describeOp(req.update.op)).toContain('Phone');
    expect(req.update.possession).not.toBeNull();
    const digest = await keystoreDigest(ACCOUNT, COMMITMENT, req.update.op);
    expect(n.api.assertions[0]!.challenge).toBe(await passkeyChallenge(digest));
    expect(await verifies(n.passkey.publicKey, n.api.assertions[0]!)).toBe(true);

    const { sender, fromAccount } = recordingSender();
    await coApprove(rpc, sender, walletOf(a.passkey), a.signer, req, 3n, NOW);
    expect(fromAccount.mock.calls[0]![0].possession).toEqual(req.update.possession);
  });

  it('rejects damaged codes', () => {
    expect(() => decodeRequest('tzk1.AAAA')).toThrow(/damaged/);
    expect(() => decodeRequest('hello')).toThrow(/not a request/);
    expect(() => decodeInvite('tzi1.@@')).toThrow(/damaged/);
  });
});

describe('recovery by guardians and hardware keys', () => {
  it('guardians approve under the recovery context until the threshold, then anyone sends', async () => {
    const g1 = await device('Guardian one');
    const g2 = await device('Guardian two');
    const lost = await device('Old laptop');
    const fresh = await device('New phone');
    const signers = [g1, g2].map((g) => ({
      rp_id: RP,
      public_key: g.passkey.publicKey,
      aaguid: g.passkey.aaguid,
      backup_eligible: false,
      backup_state: false,
      role: 'device' as const,
      label: g.passkey.label,
    }));
    const v = view(
      record([credential(lost.passkey)], { recovery_signers: signers, recovery_threshold: 2 }),
      1,
    );
    const { rpc } = chain(v);
    const started = await recoveryRequest(
      rpc,
      ACCOUNT,
      keystoreCredential(fresh.passkey),
      fresh.signer,
    );
    expect(started.kind).toBe('recovery');
    expect(started.update.possession).not.toBeNull();

    const once = await approveRecovery(rpc, decodeRequest(encodeRequest(started)), g1.signer);
    expect(once.kind).toBe('recovery');
    await expect(approveRecovery(rpc, once, g1.signer)).rejects.toThrow(/already approved/);
    await expect(approveRecovery(rpc, once, lost.signer)).rejects.toThrow(/not a recovery signer/);
    const twice = await approveRecovery(rpc, once, g2.signer);
    expect(twice.kind).toBe('send');

    const digest = await keystoreDigest(ACCOUNT, COMMITMENT, started.update.op);
    expect(g1.api.assertions[0]!.challenge).toBe(
      await passkeyChallenge(digest, RECOVERY_APPROVAL_SIGNATURE_CONTEXT),
    );

    const { sender, fromAccount } = recordingSender();
    const helper = `0x${'12'.repeat(20)}`;
    await relay(sender, twice, g2.signer, helper);
    expect(fromAccount.mock.calls[0]![2]).toBe(helper);
    await expect(relay(sender, twice, g2.signer, ACCOUNT)).rejects.toThrow(/locked account/);
    await expect(relay(sender, once, g2.signer, helper)).rejects.toThrow(/approvals/);
  });

  it('checks recovery settings and guardian cards', async () => {
    const g = await device('Guardian');
    const card = encodeSigner({
      rp_id: RP,
      public_key: g.passkey.publicKey,
      aaguid: g.passkey.aaguid,
      backup_eligible: false,
      backup_state: false,
      role: 'device',
      label: 'Sam',
    });
    const s = decodeSigner(card);
    expect(s.label).toBe('Sam');
    expect(() => decodeSigner('tzg1.e30')).toThrow(/damaged/);
    expect(() => setRecoveryOp([s], 2)).toThrow(/between 1 and 1/);
    expect(() => setRecoveryOp([s, s], 1)).toThrow(/twice/);
    expect(setRecoveryOp([], 0)).toEqual({ set_recovery: { signers: [], threshold: 0 } });
    expect(setRecoveryOp([s], 1)).toEqual({ set_recovery: { signers: [s], threshold: 1 } });
  });
});
