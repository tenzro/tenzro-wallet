/**
 * Step-up approval of one held agent action.
 *
 * When an agent's Terms hold an action for its root (above a threshold, a new
 * counterparty, a tainted argument), the serving node refuses it and returns a
 * `step_up` challenge: the custody digest for `agent_step_up` over the action's
 * digest, under the agent's wallet account. The root's passkey signs it, and
 * the agent sends the same action again with the approval as `step_up`.
 *
 * The wallet never signs a challenge it cannot tie to the action it shows: it
 * recomputes the action digest from the action the requester hands over, the
 * custody digest from that, and refuses on any difference.
 */

import { sha256 } from '@noble/hashes/sha2.js';

import { concatBytes, fromHex, toHex, utf8 } from './bytes.ts';
import { type CompositeSignatureJson, SignatureContext, webauthnChallenge } from './composite.ts';
import { custodyChallengeDigest } from './gate.ts';
import { PasskeyError } from './webauthn.ts';

const ACTION_DOMAIN = 'tenzro/agent-action/v1';
const AGENT_WALLET_DOMAIN = 'tenzro/agent-wallet';
export const OP_AGENT_STEP_UP = 'agent_step_up';

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

/** One contract or program call an action makes from the agent's wallet. */
export interface AgentVmCallWire {
  readonly vm: 'evm' | 'svm' | 'daml';
  /** Target, 20 or 32 bytes. */
  readonly to: readonly number[];
  readonly value?: number | string;
  readonly data?: readonly number[];
}

/** The payment a `pay` action makes. Digests are 64 hex. */
export interface AgentPaymentWire {
  readonly payment_id: string;
  readonly request_digest: string;
  readonly quote_digest: string;
}

/** A governance ballot an agent casts. */
export interface AgentBallotWire {
  readonly proposal_id: string;
  readonly in_favour: boolean;
  readonly validator: string;
}

/**
 * An agent action as the serving node built it (`AgentAction`): the fields
 * the agent sent, plus the agent and serving machine DIDs, the agent's action
 * nonce and the taint label the node set.
 */
export interface AgentActionWire {
  readonly agent_did: string;
  readonly machine_did: string;
  readonly operation: string;
  readonly counterparty?: string;
  /** Wei, or the smallest unit of `asset`; decimal. */
  readonly amount?: number | string;
  readonly asset?: string | null;
  readonly usd_e6?: number;
  readonly payment?: AgentPaymentWire | null;
  readonly chain?: string;
  readonly payment_protocol?: string | null;
  readonly model?: string | null;
  readonly calls?: readonly AgentVmCallWire[];
  readonly escrow?: unknown;
  readonly remote_grant?: unknown;
  readonly ballot?: AgentBallotWire | null;
  readonly veto_signal?: string | null;
  readonly nonce: number | string;
  readonly tainted?: boolean;
}

/** The `step_up` data `tenzro_agentAct` returns for a held action. */
export interface StepUpChallenge {
  readonly controller_operation: string;
  /** The agent's wallet account, 64 hex. */
  readonly account: string;
  /** 16 bytes, hex. */
  readonly nonce: string;
  /** The action digest, hex. */
  readonly target: string;
  /** The custody digest the root signs, hex. */
  readonly challenge_hex: string;
  /** base64url of the account-owner signing digest of `challenge_hex`. */
  readonly webauthn_challenge?: string;
  readonly action_nonce: number;
}

/** What a requester hands the wallet: the held action and the node's challenge for it. */
export interface StepUpRequest {
  readonly action: AgentActionWire;
  readonly step_up: StepUpChallenge;
}

/** The root's approval, as `tenzro_agentAct` takes it in `step_up`. */
export interface AgentStepUp {
  readonly account: string;
  readonly nonce: string;
  /** The root passkey's P-256 key, `x || y` hex. */
  readonly root_public_key: string;
  readonly signature: CompositeSignatureJson;
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

function uintBe(v: bigint, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  let x = v;
  for (let i = bytes - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function put(bytes: Uint8Array): Uint8Array {
  return concatBytes(u32be(bytes.length), bytes);
}

function unsigned(v: number | string | undefined, max: bigint, field: string): bigint {
  if (v === undefined) return 0n;
  const s = typeof v === 'number' ? (Number.isSafeInteger(v) ? String(v) : '') : v;
  if (!/^\d+$/.test(s))
    throw new PasskeyError(`The action's ${field} is not a whole number.`, 'invalid');
  const n = BigInt(s);
  if (n > max) throw new PasskeyError(`The action's ${field} is out of range.`, 'invalid');
  return n;
}

function byteList(v: readonly number[] | undefined, field: string): Uint8Array {
  const list = v ?? [];
  if (!list.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw new PasskeyError(`The action's ${field} is not a byte list.`, 'invalid');
  }
  return Uint8Array.from(list);
}

function hex32(v: string, field: string): string {
  const h = v.replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h))
    throw new PasskeyError(`The payment's ${field} is not 32 bytes.`, 'invalid');
  return h;
}

const VM_TAG = { evm: 0, svm: 1, daml: 2 } as const;

/** `VmCall::encode_list`. */
function encodeCalls(calls: readonly AgentVmCallWire[]): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.of(calls.length)];
  for (const c of calls) {
    const tag = VM_TAG[c.vm];
    if (tag === undefined) throw new PasskeyError('The action calls an unknown VM.', 'invalid');
    const to = byteList(c.to, 'call target');
    const data = byteList(c.data, 'call data');
    parts.push(
      Uint8Array.of(tag, to.length),
      to,
      uintBe(unsigned(c.value, U128_MAX, 'call value'), 16),
      u32be(data.length),
      data,
    );
  }
  return concatBytes(...parts);
}

/**
 * The actions the wallet can show and approve. Escrow and remote-grant
 * actions carry structures the wallet does not display; they are refused
 * rather than signed unseen.
 */
function requireShowable(a: AgentActionWire): void {
  if (a.escrow != null) {
    throw new PasskeyError('The wallet cannot show escrow actions; nothing was signed.', 'invalid');
  }
  if (a.remote_grant != null) {
    throw new PasskeyError(
      'The wallet cannot show grants on other chains; nothing was signed.',
      'invalid',
    );
  }
}

/** `AgentAction::digest`: what the serving node signs and the root's step-up targets. */
export function agentActionDigest(a: AgentActionWire): Uint8Array {
  requireShowable(a);
  const payment = a.payment
    ? utf8(
        JSON.stringify({
          payment_id: a.payment.payment_id,
          request_digest: hex32(a.payment.request_digest, 'request digest'),
          quote_digest: hex32(a.payment.quote_digest, 'quote digest'),
        }),
      )
    : new Uint8Array(0);
  const parts: Uint8Array[] = [
    utf8(ACTION_DOMAIN),
    put(utf8(a.agent_did)),
    put(utf8(a.machine_did)),
    put(utf8(a.operation)),
    put(utf8(a.counterparty ?? '')),
    uintBe(unsigned(a.amount, U128_MAX, 'amount'), 16),
    put(utf8(a.asset ?? '')),
    uintBe(unsigned(a.usd_e6, U64_MAX, 'USD price'), 8),
    put(payment),
    put(utf8(a.chain ?? '')),
    put(utf8(a.payment_protocol ?? '')),
    put(utf8(a.model ?? '')),
    put(encodeCalls(a.calls ?? [])),
    put(new Uint8Array(0)),
    put(new Uint8Array(0)),
    uintBe(unsigned(a.nonce, U64_MAX, 'nonce'), 8),
    Uint8Array.of(a.tainted ? 1 : 0),
  ];
  if (a.ballot) {
    parts.push(
      put(utf8('ballot')),
      put(utf8(a.ballot.proposal_id)),
      Uint8Array.of(a.ballot.in_favour ? 1 : 0),
      put(utf8(a.ballot.validator)),
    );
  }
  if (a.veto_signal != null) {
    parts.push(put(utf8('veto_signal')), put(utf8(a.veto_signal)));
  }
  return sha256(concatBytes(...parts));
}

/** The wallet account of a delegated agent: `SHA-256("tenzro/agent-wallet" || did)[0..20]`, zero-padded to 32 bytes. */
export function agentWalletAccount(agentDid: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(sha256(concatBytes(utf8(AGENT_WALLET_DOMAIN), utf8(agentDid))).slice(0, 20));
  return out;
}

const plain = (h: string) => h.replace(/^0x/, '').toLowerCase();

/**
 * Checks that the node's challenge is for exactly `action`: the agent's wallet
 * account, the action digest as target, the action's nonce, and the custody
 * digest those make. Returns the custody digest the root signs.
 */
export function checkStepUp(req: StepUpRequest): Uint8Array {
  const { action, step_up: s } = req;
  if (s.controller_operation !== OP_AGENT_STEP_UP) {
    throw new PasskeyError('The request is not a step-up of an agent action.', 'invalid');
  }
  const target = agentActionDigest(action);
  const account = agentWalletAccount(action.agent_did);
  const nonce = fromHex(s.nonce);
  const digest = custodyChallengeDigest(account, OP_AGENT_STEP_UP, target, nonce);
  if (
    nonce.length !== 16 ||
    plain(s.account) !== toHex(account) ||
    plain(s.target) !== toHex(target) ||
    plain(s.challenge_hex) !== toHex(digest) ||
    BigInt(s.action_nonce) !== unsigned(action.nonce, U64_MAX, 'nonce')
  ) {
    throw new PasskeyError(
      'The challenge is for a different action than the one shown; nothing was signed.',
      'invalid',
    );
  }
  if (
    s.webauthn_challenge !== undefined &&
    s.webauthn_challenge !== webauthnChallenge(SignatureContext.AccountOwner, digest)
  ) {
    throw new PasskeyError('The node issued a malformed step-up challenge.', 'invalid');
  }
  return digest;
}

/** Parses a pasted or posted step-up request; throws on anything else. */
export function parseStepUpRequest(value: unknown): StepUpRequest {
  const v = (typeof value === 'string' ? JSON.parse(value) : value) as Record<
    string,
    unknown
  > | null;
  const action = v?.action as AgentActionWire | undefined;
  const raw = v?.step_up as Record<string, unknown> | undefined;
  const stepUp = (raw?.step_up ?? raw) as StepUpChallenge | undefined;
  if (
    !action ||
    typeof action.agent_did !== 'string' ||
    typeof action.machine_did !== 'string' ||
    typeof action.operation !== 'string' ||
    action.nonce === undefined ||
    !stepUp ||
    typeof stepUp.challenge_hex !== 'string' ||
    typeof stepUp.account !== 'string' ||
    typeof stepUp.nonce !== 'string' ||
    typeof stepUp.target !== 'string'
  ) {
    throw new PasskeyError(
      'A step-up request carries the held action and the step_up data the node returned for it.',
      'invalid',
    );
  }
  return { action, step_up: stepUp };
}
