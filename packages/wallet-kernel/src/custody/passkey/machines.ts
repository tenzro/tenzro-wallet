/**
 * Agents and machines owned by a person.
 *
 * Ownership rules (enforced by the network; mirrored here so the wallet never
 * offers a path the network would refuse or that leaves an identity without
 * an owner):
 *
 *   - A machine identity is rooted in that machine's secure element: a TPM 2.0
 *     or a Secure Enclave. Its runtime supplies the device key's public half
 *     and a machine id; the private half never leaves the hardware. The
 *     wallet never generates an agent or machine key.
 *   - A machine or agent created from this wallet is delegated: its controller
 *     is the person's human DID (`did:tenzro:human:...`). The network refuses
 *     any other controller on these paths.
 *   - An autonomous machine (controller "self") registers itself from its own
 *     TPM-rooted runtime; the wallet does not create those.
 *   - Spending from the person's own account is a separate grant: a scoped
 *     session key approved with the person's passkey (`PasskeyCustody.grantSessionKey`).
 *
 * Request shapes mirror `crates/tenzro-node/src/rpc.rs`
 * (`handle_onboard_delegated_agent`, `handle_register_machine_identity`).
 */

import { parseTdipDid } from '../../identity/did.ts';
import { fromHex, normalizeHex } from './bytes.ts';
import type { JsonRpcTransport } from './rpc.ts';
import { PasskeyError } from './webauthn.ts';

/** What a machine's runtime shows the owner (paste or QR): the public half of its hardware key. */
export interface DevicePairing {
  /** Public key held by the machine's TPM / Secure Enclave, hex. */
  readonly devicePublicKeyHex: string;
  /** Identifier of the secure element that holds the key. */
  readonly machineId: string;
}

/**
 * Delegation scope. Amounts are wei (TNZO base units) as decimal strings.
 * Both caps are required: the wallet never creates an uncapped delegate.
 */
export interface DelegationScopeInput {
  readonly maxTransactionValueWei: string;
  readonly maxDailySpendWei: string;
  readonly allowedOperations?: readonly string[];
  readonly allowedPaymentProtocols?: readonly string[];
  readonly allowedChains?: readonly string[];
}

export interface DelegatedAgentResult {
  readonly identity: {
    readonly did: string;
    readonly identity_type: string;
    readonly controller_did: string;
    readonly capabilities: readonly string[];
    readonly status: string;
  };
  readonly wallet: { readonly wallet_id: string; readonly address: string; readonly public_key: string };
  /** Tokens belong to the agent. Hand them to its runtime; never keep them in the wallet. */
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly dpop_bound: boolean;
}

const DECIMAL = /^[0-9]+$/;

function requireHumanController(did: string): void {
  let kind: string;
  try {
    kind = parseTdipDid(did).kind;
  } catch {
    throw new PasskeyError('The owner must be a Tenzro identity (did:tenzro:human:...).', 'invalid');
  }
  if (kind !== 'human') {
    throw new PasskeyError('Only a person (a human DID) can own agents created from this wallet.', 'invalid');
  }
}

function requirePairing(p: DevicePairing): string {
  const hex = normalizeHex(p.devicePublicKeyHex.trim());
  if (hex.length === 0 || fromHex(hex).length === 0) {
    throw new PasskeyError('The device public key is missing.', 'invalid');
  }
  if (!p.machineId.trim()) {
    throw new PasskeyError('The machine id is missing.', 'invalid');
  }
  return hex;
}

function scopeJson(scope: DelegationScopeInput): Record<string, unknown> {
  if (!DECIMAL.test(scope.maxTransactionValueWei) || !DECIMAL.test(scope.maxDailySpendWei)) {
    throw new PasskeyError('Spending caps must be whole numbers of wei.', 'invalid');
  }
  return {
    max_transaction_value: scope.maxTransactionValueWei,
    max_daily_spend: scope.maxDailySpendWei,
    ...(scope.allowedOperations?.length ? { allowed_operations: [...scope.allowedOperations] } : {}),
    ...(scope.allowedPaymentProtocols?.length
      ? { allowed_payment_protocols: [...scope.allowedPaymentProtocols] }
      : {}),
    ...(scope.allowedChains?.length ? { allowed_chains: [...scope.allowedChains] } : {}),
  };
}

/**
 * Creates an agent identity and wallet controlled by `controllerDid`
 * (`tenzro_onboardDelegatedAgent`). The agent's key is its machine's
 * hardware key; its DPoP key (optional) is supplied by the agent runtime.
 */
export async function onboardDelegatedAgent(
  rpc: JsonRpcTransport,
  opts: {
    readonly controllerDid: string;
    readonly pairing: DevicePairing;
    readonly capabilities: readonly string[];
    readonly scope: DelegationScopeInput;
    readonly dpopJwk?: Readonly<Record<string, string>>;
    readonly ttlSecs?: number;
  },
): Promise<DelegatedAgentResult> {
  requireHumanController(opts.controllerDid);
  const devicePublicKey = requirePairing(opts.pairing);
  return rpc.call<DelegatedAgentResult>('tenzro_onboardDelegatedAgent', {
    controller_did: opts.controllerDid,
    device_public_key: devicePublicKey,
    machine_id: opts.pairing.machineId.trim(),
    capabilities: [...opts.capabilities],
    delegation_scope: scopeJson(opts.scope),
    ...(opts.dpopJwk ? { dpop_jwk: { ...opts.dpopJwk } } : {}),
    ...(opts.ttlSecs !== undefined ? { ttl_secs: opts.ttlSecs } : {}),
  });
}

/** Registers a machine controlled by `controllerDid` (`tenzro_registerMachineIdentity`). */
export async function registerControlledMachine(
  rpc: JsonRpcTransport,
  opts: {
    readonly controllerDid: string;
    readonly devicePublicKeyHex: string;
    readonly capabilities: readonly string[];
    readonly scope: DelegationScopeInput;
  },
): Promise<{ did: string; controller_did: string; status: string; capabilities: readonly string[] }> {
  requireHumanController(opts.controllerDid);
  const key = requirePairing({ devicePublicKeyHex: opts.devicePublicKeyHex, machineId: 'machine' });
  if (opts.capabilities.length === 0) {
    throw new PasskeyError('Name at least one capability for the machine.', 'invalid');
  }
  return rpc.call('tenzro_registerMachineIdentity', {
    controller_did: opts.controllerDid,
    capabilities: [...opts.capabilities],
    public_key: key,
    delegation_scope: scopeJson(opts.scope),
  });
}

/** DIDs of the machines and agents a person controls (`tenzro_resolveIdentity` with the record). */
export async function listControlledMachines(
  rpc: JsonRpcTransport,
  humanDid: string,
): Promise<string[]> {
  const res = await rpc.call<{
    record?: { identity_data?: { Human?: { controlled_machines?: string[] } } };
  }>('tenzro_resolveIdentity', { did: humanDid, include_record: true });
  return res.record?.identity_data?.Human?.controlled_machines ?? [];
}

export async function getAgentDailySpend(
  rpc: JsonRpcTransport,
  agentDid: string,
): Promise<{ max_daily_spend?: string; current_daily_spend?: string; remaining?: string }> {
  return rpc.call('tenzro_getAgentDailySpend', { agent_did: agentDid });
}
