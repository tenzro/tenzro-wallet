/**
 * The account: a smart account whose keystore on chain lists the passkeys
 * that act for it. Creating one takes a passkey and nothing else: no seed
 * phrase, no key to write down. This device remembers only public data.
 */

import { type KeystoreAnchor, KeystoreClient, PasskeyRpcClient, type RpcClient } from 'tenzro-sdk';

import { toHex } from './bytes';
import {
  type CredentialsApi,
  type Passkey,
  PasskeySigner,
  browserCredentials,
  createPasskey,
  passkeyOf,
  pickPasskey,
} from './passkey';

export interface Wallet {
  /** The account, `0x` hex as the node returns it. */
  readonly account: string;
  readonly did: string;
  /** This device's passkey. */
  readonly passkey: Passkey;
  /** The account's first passkey while its keystore is not yet on chain. */
  readonly anchor: KeystoreAnchor | null;
}

const STORE_KEY = 'wallet';

/** Where the wallet keeps its public data; tests pass a map. */
export interface WalletStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function store(): WalletStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadWallet(s: WalletStore | null = store()): Wallet | null {
  const raw = s?.getItem(STORE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Wallet;
  } catch {
    return null;
  }
}

export function saveWallet(wallet: Wallet, s: WalletStore | null = store()): void {
  s?.setItem(STORE_KEY, JSON.stringify(wallet));
}

export function forgetWallet(s: WalletStore | null = store()): void {
  s?.removeItem(STORE_KEY);
}

export function signerOf(wallet: Wallet, api?: CredentialsApi): PasskeySigner {
  return new PasskeySigner(wallet.passkey, api ?? browserCredentials());
}

/** A custody authorization by this device's passkey, for the challenge the node issued. */
export async function authorize(
  wallet: Wallet,
  challenge: { challenge_id: string; webauthn_challenge: string },
  signer: PasskeySigner = signerOf(wallet),
) {
  return {
    challenge_id: challenge.challenge_id,
    credential_id_hex: `0x${wallet.passkey.credentialId}`,
    assertion: await signer.assertChallenge(challenge.webauthn_challenge),
    ...(wallet.anchor ? { anchor: wallet.anchor } : {}),
  };
}

export interface CreateAccountOptions {
  readonly rpId: string;
  readonly rpName: string;
  readonly name: string;
  readonly deviceLabel: string;
  readonly api?: CredentialsApi;
}

/**
 * One tap: the passkey is created, proves possession of itself to the node,
 * and the node answers the identity and account it derives. A node of
 * another operator, where there is one, must derive the same account from
 * the same passkey before the wallet accepts it.
 */
export async function createAccount(
  rpc: RpcClient,
  second: RpcClient | null,
  opts: CreateAccountOptions,
): Promise<Wallet> {
  const api = opts.api ?? browserCredentials();
  const created = await createPasskey(
    { rpId: opts.rpId, rpName: opts.rpName, userName: opts.name, label: opts.deviceLabel },
    api,
  );
  const passkeys = new PasskeyRpcClient(rpc);
  const challenge = await passkeys.createCustodyChallenge({
    account_address: `0x${created.publicKey}`,
    operation: 'enroll_passkey',
    target_hex: `0x${created.credentialId}`,
  });
  const signer = new PasskeySigner(created, api);
  const enrolled = await passkeys.enroll({
    display_name: opts.name,
    passkey_public_key_hex: `0x${created.publicKey}`,
    credential_id_hex: `0x${created.credentialId}`,
    registration_authenticator_data_hex: `0x${toHex(created.registrationAuthenticatorData)}`,
    rp_id: opts.rpId,
    salt: 0,
    authorization: {
      challenge_id: challenge.challenge_id,
      credential_id_hex: `0x${created.credentialId}`,
      assertion: await signer.assertChallenge(challenge.webauthn_challenge),
    },
  });
  const anchor = enrolled.anchor;
  const check = new KeystoreClient(second ?? rpc);
  const view = await check.getKeystore(enrolled.smart_account_address, anchor ?? undefined);
  if (sameAccount(view.account, enrolled.smart_account_address) === false) {
    throw new Error('Two nodes derived different accounts for this passkey.');
  }
  const { registrationAuthenticatorData: _, ...passkey } = created;
  return { account: enrolled.smart_account_address, did: enrolled.did, passkey, anchor };
}

export function sameAccount(a: string, b: string): boolean {
  const n = (x: string) =>
    x
      .replace(/^0x/, '')
      .toLowerCase()
      .replace(/(00){12}$/, '');
  return n(a) === n(b);
}

/**
 * Signing in on a device: the person picks a passkey, the network says which
 * account's keystore links it, and the keystore gives its public key.
 */
export async function signIn(
  rpc: RpcClient,
  rpId: string,
  api: CredentialsApi = browserCredentials(),
): Promise<Wallet> {
  const credentialId = await pickPasskey(rpId, api);
  const keystores = new KeystoreClient(rpc);
  const { accounts } = await keystores.resolveCredential(credentialId, rpId);
  const account = accounts[0];
  if (!account) {
    const local = loadWallet();
    if (local && local.passkey.credentialId === credentialId) return local;
    throw new Error(
      'No account on the network links this passkey yet. Open the wallet on the device that created it.',
    );
  }
  const view = await keystores.getKeystore(account);
  const credential = view.keystore?.credentials.find(
    (c) => c.credential_id.replace(/^0x/, '') === credentialId && c.rp_id === rpId,
  );
  if (!view.keystore || !credential) {
    throw new Error('The account no longer links this passkey.');
  }
  return { account, did: view.keystore.owner_did, passkey: passkeyOf(credential), anchor: null };
}
