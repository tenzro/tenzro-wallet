/**
 * A mocked network that holds passkey account keystores and applies the
 * keystore changes sent to it, for the custody tests.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import type { HybridSigner, TypedTransaction } from 'tenzro-sdk';

import { fromHex, toHex, utf8 } from './bytes.ts';
import { SignatureContext, webauthnChallenge } from './composite.ts';
import { humanDidFromPasskey, smartAccountAddress } from './derive.ts';
import { MockRpc } from './fake-authenticator.fixture.ts';
import { custodyChallengeDigest } from './gate.ts';
import type { KeystoreAnchor, KeystoreOp, KeystoreRecord, KeystoreUpdate } from './keystore.ts';

const commitmentOf = (r: KeystoreRecord) => toHex(sha256(utf8(JSON.stringify(r))));

/** A network that holds keystores and applies the changes sent to it. */
export function network() {
  const records = new Map<string, KeystoreRecord>();
  const enrolled = new Map<string, KeystoreAnchor>();
  const sent: Array<{ key: Uint8Array; tx: TypedTransaction; signature: unknown }> = [];
  let challenges = 0;
  const genesis = (a: KeystoreAnchor): KeystoreRecord => ({
    account: toHex(smartAccountAddress(fromHex(a.public_key), fromHex(a.credential_id), a.salt)),
    owner_did: humanDidFromPasskey(fromHex(a.public_key)),
    salt: a.salt,
    version: 0,
    credentials: [
      {
        rp_id: a.rp_id,
        credential_id: a.credential_id,
        public_key: a.public_key,
        aaguid: a.aaguid,
        backup_eligible: a.backup_eligible,
        backup_state: a.backup_state,
        counts_as_root_from_ms: 0,
        label: '',
      },
    ],
    policy: 'single_credential',
    recovery_signers: [],
    recovery_threshold: 0,
    pending_recovery: null,
  });
  const strip = (h: string) => h.replace(/^0x/, '').toLowerCase();
  const rpc = new MockRpc({
    tenzro_createCustodyChallenge: (p: {
      account_address: string;
      operation: string;
      target_hex?: string;
    }) => {
      challenges += 1;
      const nonce = new Uint8Array(16).fill(challenges);
      const target = p.target_hex ? fromHex(p.target_hex) : new Uint8Array(0);
      const digest = custodyChallengeDigest(fromHex(p.account_address), p.operation, target, nonce);
      return {
        challenge_id: `c${challenges}`,
        challenge_hex: toHex(digest, true),
        webauthn_challenge: webauthnChallenge(SignatureContext.AccountOwner, digest),
        nonce_hex: toHex(nonce, true),
        target_hex: toHex(target, true),
        expires_in_secs: 300,
      };
    },
    tenzro_enrollPasskey: (p: {
      passkey_public_key_hex: string;
      credential_id_hex: string;
      rp_id: string;
      registration_authenticator_data_hex?: string;
      salt: number;
    }) => {
      // A further wallet is enrolled with an authorization instead of a
      // registration: the passkey's provenance is the one first enrolled.
      const known = enrolled.get(strip(p.passkey_public_key_hex));
      const reg = p.registration_authenticator_data_hex
        ? fromHex(p.registration_authenticator_data_hex)
        : null;
      if (!reg && !known) throw new Error('unknown passkey');
      const anchor: KeystoreAnchor = {
        rp_id: p.rp_id,
        credential_id: strip(p.credential_id_hex),
        public_key: strip(p.passkey_public_key_hex),
        aaguid: reg ? toHex(reg.slice(37, 53)) : (known as KeystoreAnchor).aaguid,
        backup_eligible: reg
          ? ((reg[32] ?? 0) & 0x08) !== 0
          : (known as KeystoreAnchor).backup_eligible,
        backup_state: reg ? ((reg[32] ?? 0) & 0x10) !== 0 : (known as KeystoreAnchor).backup_state,
        salt: p.salt,
      };
      if (!known) enrolled.set(anchor.public_key, anchor);
      const g = genesis(anchor);
      return {
        did: g.owner_did,
        smart_account_address: `0x${g.account}`,
        credential_id_hex: p.credential_id_hex,
        keystore: g,
        keystore_commitment: commitmentOf(g),
        anchor,
      };
    },
    tenzro_getKeystore: (p: { account: string; anchor?: KeystoreAnchor }) => {
      const on = records.get(strip(p.account));
      const r = on ?? (p.anchor ? genesis(p.anchor) : null);
      if (!r) return { account: strip(p.account), on_chain: false, keystore: null };
      return {
        account: strip(p.account),
        on_chain: !!on,
        keystore: r,
        commitment: commitmentOf(r),
      };
    },
    tenzro_resolveCredential: (p: { credential_id: string; rp_id: string }) => ({
      accounts: [...records.values()]
        .filter((r) =>
          r.credentials.some(
            (c) => strip(c.credential_id) === strip(p.credential_id) && c.rp_id === p.rp_id,
          ),
        )
        .map((r) => r.account),
    }),
    tenzro_getAgentTerms: (p: { agent_did: string }) => ({
      agent_did: p.agent_did,
      root_kind: 'passkey',
      status: 'active',
      terms: { controller_did: [...records.values()][0]?.owner_did },
    }),
  });
  const apply = (u: KeystoreUpdate) => {
    const current = records.get(strip(u.account)) ?? (u.anchor ? genesis(u.anchor) : undefined);
    if (!current || commitmentOf(current) !== strip(u.previous_commitment))
      throw new Error('stale change');
    const op = u.op as Exclude<KeystoreOp, string> | string;
    let next: KeystoreRecord = { ...current, version: current.version + 1 };
    if (typeof op === 'object' && 'add_credential' in op)
      next = { ...next, credentials: [...next.credentials, op.add_credential.credential] };
    if (typeof op === 'object' && 'remove_credential' in op) {
      next = {
        ...next,
        credentials: next.credentials.filter(
          (c) => strip(c.credential_id) !== strip(op.remove_credential.credential_id),
        ),
      };
    }
    if (typeof op === 'object' && 'set_policy' in op)
      next = { ...next, policy: op.set_policy.policy };
    if (typeof op === 'object' && 'set_recovery' in op) {
      next = {
        ...next,
        recovery_signers: op.set_recovery.signers,
        recovery_threshold: op.set_recovery.threshold,
      };
    }
    if (typeof op === 'object' && 'start_recovery' in op) {
      next = {
        ...next,
        pending_recovery: {
          credential: op.start_recovery.credential,
          approvers: [0],
          started_at_ms: 0,
          ready_at_ms: 0,
        },
      };
    }
    if (op === 'finish_recovery' && next.pending_recovery) {
      next = {
        ...next,
        credentials: [...next.credentials, next.pending_recovery.credential],
        pending_recovery: null,
      };
    }
    if (op === 'cancel_recovery') next = { ...next, pending_recovery: null };
    records.set(strip(u.account), next);
  };
  const sender = {
    async send(signer: HybridSigner, tx: TypedTransaction) {
      const digest = sha256(utf8(JSON.stringify(tx.fields)));
      const [classical] = await signer.signComposite(digest);
      sent.push({ key: signer.p256PublicKey(), tx, signature: classical });
      apply((tx.fields as { update: KeystoreUpdate }).update);
      return { hash: `0x${toHex(digest)}` };
    },
  };
  return { rpc, sender, records, sent, apply };
}
