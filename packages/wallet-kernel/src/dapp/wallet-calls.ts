/**
 * ERC-5792 call batches and ERC-7715 permissions over the native account.
 *
 * A call batch (`wallet_sendCalls`) is one native contract-call transaction
 * from the wallet's account: the network runs its calls in order and applies
 * all of them or none, and the account's passkey approves it once. The
 * batch id is the transaction's hash.
 *
 * A permission (`wallet_requestExecutionPermissions`) is a spend limit in the
 * Terms of one of the identity's agents, per clock hour or per day, with an
 * optional expiry. The Terms are recorded in consensus and every validator
 * checks each of the agent's actions against them. The agent acts through
 * its serving nodes, so no delegation contract redeems the permission:
 * `delegationManager` is the zero address and `context` names the agent.
 *
 * Everything here is pure: it checks requests and shapes answers. Signing
 * and sending happen in the wallet with the passkey.
 */

/** ERC-5792 version of the batches this wallet sends. */
export const CALLS_VERSION = '2.0.0';

/** Most calls one batch may carry (the network's limit per transaction). */
export const MAX_CALLS = 16;

/** Error codes of ERC-5792 and ERC-7715, and the EIP-1193 ones they use. */
export const WALLET_CALL_ERRORS = {
  rejected: 4001,
  unauthorized: 4100,
  invalidParams: -32602,
  unsupportedCapability: 5700,
  unsupportedChain: 5710,
  unknownBundle: 5730,
  bundleTooLarge: 5740,
} as const;

/** What this wallet supports for call batches, per chain (`wallet_getCapabilities`). */
export const WALLET_CAPABILITIES = {
  atomic: { status: 'supported' },
  paymasterService: { supported: false },
} as const;

/** The permission type this wallet grants. */
export const NATIVE_TOKEN_PERIODIC = 'native-token-periodic';

const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const HOUR = 3_600;
const DAY = 86_400;

export class WalletCallError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'WalletCallError';
  }
}

function fail(code: number, message: string): never {
  throw new WalletCallError(code, message);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hexBytes(v: unknown, what: string, length?: number): number[] {
  if (v === undefined || v === null || v === '0x') {
    if (length !== undefined) fail(WALLET_CALL_ERRORS.invalidParams, `${what} is required`);
    return [];
  }
  if (typeof v !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(v)) {
    fail(WALLET_CALL_ERRORS.invalidParams, `${what} must be 0x-prefixed hex`);
  }
  const out: number[] = [];
  for (let i = 2; i < v.length; i += 2) out.push(Number.parseInt(v.slice(i, i + 2), 16));
  if (length !== undefined && out.length !== length) {
    fail(WALLET_CALL_ERRORS.invalidParams, `${what} must be ${length} bytes`);
  }
  return out;
}

function quantity(v: unknown, what: string): bigint {
  if (v === undefined || v === null) return 0n;
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v)) return BigInt(v);
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
  fail(WALLET_CALL_ERRORS.invalidParams, `${what} must be a non-negative quantity`);
}

/** A chain id as lowercase hex without leading zeros. */
export function chainIdHex(v: unknown): string {
  return `0x${quantity(v, 'chainId').toString(16)}`;
}

function sameAccount(a: string, b: string): boolean {
  const norm = (x: string) => {
    const h = x.toLowerCase().replace(/^0x/, '');
    return h.length === 64 && h.endsWith('0'.repeat(24)) ? h.slice(0, 40) : h;
  };
  return norm(a) === norm(b);
}

/** Refuse a capability this wallet does not support unless the caller marked it optional. */
function checkCapabilities(caps: unknown, where: string): void {
  if (caps === undefined) return;
  if (!isRecord(caps))
    fail(WALLET_CALL_ERRORS.invalidParams, `${where} capabilities must be an object`);
  for (const [name, cap] of Object.entries(caps)) {
    if (isRecord(cap) && cap.optional === true) continue;
    fail(WALLET_CALL_ERRORS.unsupportedCapability, `capability ${name} is not supported`);
  }
}

/** One call of a native contract-call transaction, as the network's JSON encodes it. */
export interface NativeEvmCall {
  readonly vm: 'evm';
  readonly to: number[];
  readonly value: bigint;
  readonly data: number[];
}

/** A checked `wallet_sendCalls` request. */
export interface CallBatch {
  readonly chainId: string;
  readonly calls: readonly NativeEvmCall[];
}

/**
 * Check `wallet_sendCalls` params against the wallet's account and chain.
 * Throws a {@link WalletCallError} with the standard code when it cannot be
 * sent.
 */
export function parseSendCalls(
  params: unknown,
  ctx: { readonly chainId: string; readonly account: string },
): CallBatch {
  const req = Array.isArray(params) ? params[0] : params;
  if (!isRecord(req))
    fail(WALLET_CALL_ERRORS.invalidParams, 'wallet_sendCalls takes one request object');
  if (typeof req.version !== 'string' || req.version.split('.')[0] !== '2') {
    fail(
      WALLET_CALL_ERRORS.invalidParams,
      `unsupported version ${String(req.version)}; this wallet speaks ${CALLS_VERSION}`,
    );
  }
  if (chainIdHex(req.chainId) !== chainIdHex(ctx.chainId)) {
    fail(
      WALLET_CALL_ERRORS.unsupportedChain,
      `chain ${String(req.chainId)} is not this wallet's network`,
    );
  }
  if (
    req.from !== undefined &&
    (typeof req.from !== 'string' || !sameAccount(req.from, ctx.account))
  ) {
    fail(WALLET_CALL_ERRORS.unauthorized, 'from is not the connected account');
  }
  if (req.atomicRequired !== undefined && typeof req.atomicRequired !== 'boolean') {
    fail(WALLET_CALL_ERRORS.invalidParams, 'atomicRequired must be a boolean');
  }
  checkCapabilities(req.capabilities, 'request');
  if (!Array.isArray(req.calls) || req.calls.length === 0) {
    fail(WALLET_CALL_ERRORS.invalidParams, 'calls must hold at least one call');
  }
  if (req.calls.length > MAX_CALLS) {
    fail(WALLET_CALL_ERRORS.bundleTooLarge, `a batch holds at most ${MAX_CALLS} calls`);
  }
  const calls = req.calls.map((c: unknown, i: number): NativeEvmCall => {
    if (!isRecord(c)) fail(WALLET_CALL_ERRORS.invalidParams, `call ${i} must be an object`);
    checkCapabilities(c.capabilities, `call ${i}`);
    if (c.to === undefined)
      fail(
        WALLET_CALL_ERRORS.invalidParams,
        `call ${i}: contract creation is not supported in a batch`,
      );
    return {
      vm: 'evm',
      to: hexBytes(c.to, `call ${i} to`, 20),
      value: quantity(c.value, `call ${i} value`),
      data: hexBytes(c.data, `call ${i} data`),
    };
  });
  return { chainId: chainIdHex(req.chainId), calls };
}

/** The `ContractCall` fields of the one transaction a batch is. */
export function contractCallFields(batch: CallBatch): { calls: readonly NativeEvmCall[] } {
  return { calls: batch.calls };
}

/** An EVM receipt as `eth_getTransactionReceipt` answers it. */
export interface EvmReceipt {
  readonly status?: string;
  readonly logs?: readonly { address: string; data: string; topics: string[] }[];
  readonly blockHash?: string;
  readonly blockNumber?: string;
  readonly gasUsed?: string;
  readonly transactionHash?: string;
}

/** `wallet_getCallsStatus` for a batch whose transaction is `id`. */
export function callsStatus(id: string, chainId: string, receipt: EvmReceipt | null) {
  if (!receipt) return { version: CALLS_VERSION, id, chainId, status: 100, atomic: true };
  const ok = receipt.status === '0x1';
  return {
    version: CALLS_VERSION,
    id,
    chainId,
    status: ok ? 200 : 500,
    atomic: true,
    receipts: [
      {
        logs: (receipt.logs ?? []).map((l) => ({
          address: l.address,
          data: l.data,
          topics: l.topics,
        })),
        status: ok ? '0x1' : '0x0',
        blockHash: receipt.blockHash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        transactionHash: receipt.transactionHash ?? id,
      },
    ],
  };
}

/** `wallet_getSupportedExecutionPermissions`. */
export function supportedExecutionPermissions(chainId: string) {
  return { [NATIVE_TOKEN_PERIODIC]: { chainIds: [chainIdHex(chainId)], ruleTypes: ['expiry'] } };
}

/** A spend limit a permission grants: per clock hour or per day, wei. */
export interface SpendGrant {
  /** The agent's wallet address, 20 bytes of lowercase hex with `0x`. */
  readonly agentWallet: string;
  readonly window: 'hour' | 'day';
  readonly amountWei: bigint;
  /** Unix ms the Terms expire at, or null for no expiry. */
  readonly expiresAtMs: number | null;
  /** The request as granted (the wallet may have adjusted it), for the answer. */
  readonly granted: Record<string, unknown>;
}

/**
 * Check one ERC-7715 permission request and turn it into a spend limit.
 * `nowMs` is the current time. A period that is neither an hour nor a day is
 * scaled down to one when the request allows adjustment, and refused
 * otherwise.
 */
export function parsePermissionRequest(
  req: unknown,
  ctx: { readonly chainId: string; readonly account: string; readonly nowMs: number },
): SpendGrant {
  if (!isRecord(req))
    fail(WALLET_CALL_ERRORS.invalidParams, 'a permission request must be an object');
  if (chainIdHex(req.chainId) !== chainIdHex(ctx.chainId)) {
    fail(
      WALLET_CALL_ERRORS.unsupportedChain,
      `chain ${String(req.chainId)} is not this wallet's network`,
    );
  }
  if (
    req.from !== undefined &&
    (typeof req.from !== 'string' || !sameAccount(req.from, ctx.account))
  ) {
    fail(WALLET_CALL_ERRORS.unauthorized, 'from is not the connected account');
  }
  const to = hexBytes(req.to, 'to', 20);
  const permission = req.permission;
  if (
    !isRecord(permission) ||
    permission.type !== NATIVE_TOKEN_PERIODIC ||
    !isRecord(permission.data)
  ) {
    fail(
      WALLET_CALL_ERRORS.invalidParams,
      `unsupported permission type ${String(isRecord(permission) ? permission.type : permission)}; this wallet grants ${NATIVE_TOKEN_PERIODIC}`,
    );
  }
  const adjustable = permission.isAdjustmentAllowed === true;
  const data = permission.data;
  const amount = quantity(data.periodAmount, 'periodAmount');
  const duration = Number(quantity(data.periodDuration, 'periodDuration'));
  let window: 'hour' | 'day';
  let amountWei: bigint;
  if (duration === HOUR || duration === DAY) {
    window = duration === HOUR ? 'hour' : 'day';
    amountWei = amount;
  } else if (adjustable && duration > DAY) {
    window = 'day';
    amountWei = (amount * BigInt(DAY)) / BigInt(duration);
  } else if (adjustable && duration > HOUR) {
    window = 'hour';
    amountWei = (amount * BigInt(HOUR)) / BigInt(duration);
  } else {
    fail(
      WALLET_CALL_ERRORS.invalidParams,
      'periodDuration must be 3600 (an hour) or 86400 (a day)',
    );
  }
  const nowSecs = Math.floor(ctx.nowMs / 1000);
  if (
    data.startTime !== undefined &&
    Number(quantity(data.startTime, 'startTime')) > nowSecs + 60 &&
    !adjustable
  ) {
    fail(
      WALLET_CALL_ERRORS.invalidParams,
      'a limit applies from when it is granted; startTime must not be in the future',
    );
  }
  let expiresAtMs: number | null = null;
  const rules = req.rules === undefined ? [] : req.rules;
  if (!Array.isArray(rules)) fail(WALLET_CALL_ERRORS.invalidParams, 'rules must be an array');
  for (const rule of rules) {
    if (!isRecord(rule) || rule.type !== 'expiry' || !isRecord(rule.data)) {
      fail(
        WALLET_CALL_ERRORS.invalidParams,
        `unsupported rule ${String(isRecord(rule) ? rule.type : rule)}`,
      );
    }
    const ts = Number(quantity(rule.data.timestamp, 'expiry timestamp'));
    if (ts <= nowSecs) fail(WALLET_CALL_ERRORS.invalidParams, 'expiry is in the past');
    expiresAtMs = ts * 1000;
  }
  const grantedData: Record<string, unknown> = {
    ...data,
    periodAmount: `0x${amountWei.toString(16)}`,
    periodDuration: window === 'hour' ? HOUR : DAY,
    startTime: nowSecs,
  };
  return {
    agentWallet: `0x${to.map((b) => b.toString(16).padStart(2, '0')).join('')}`,
    window,
    amountWei,
    expiresAtMs,
    granted: { ...req, permission: { ...permission, data: grantedData } },
  };
}

/** The context that names an agent: its DID, UTF-8, as hex. */
export function permissionContext(agentDid: string): string {
  const bytes = new TextEncoder().encode(agentDid);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The agent DID a context names. */
export function agentOfContext(context: unknown): string {
  const bytes = hexBytes(context, 'permissionContext');
  const did = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  if (!did.startsWith('did:'))
    fail(WALLET_CALL_ERRORS.invalidParams, 'permissionContext names no agent');
  return did;
}

/** The answer for one granted permission. */
export function permissionResponse(grant: SpendGrant, agentDid: string): Record<string, unknown> {
  return {
    ...grant.granted,
    context: permissionContext(agentDid),
    dependencies: [],
    delegationManager: ZERO_ADDRESS,
  };
}

/**
 * The address of an agent's wallet, as the network derives it from the
 * agent's DID: the first 20 bytes of SHA-256("tenzro/agent-wallet" ‖ did).
 */
export async function agentWalletAddress(agentDid: string): Promise<string> {
  const enc = new TextEncoder();
  const pre = new Uint8Array([...enc.encode('tenzro/agent-wallet'), ...enc.encode(agentDid)]);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', pre));
  return `0x${Array.from(digest.slice(0, 20), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The spend limits one agent's Terms hold, as granted permissions. */
export async function grantedPermissions(
  agents: readonly {
    readonly agent_did: string;
    readonly terms: {
      readonly expires_at_ms?: number | null;
      readonly delegation_scope?: {
        readonly max_hourly_spend?: string | null;
        readonly max_daily_spend?: string | null;
      };
    };
  }[],
  ctx: { readonly chainId: string; readonly account: string },
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const a of agents) {
    const scope = a.terms.delegation_scope ?? {};
    const to = await agentWalletAddress(a.agent_did);
    const rules = a.terms.expires_at_ms
      ? [{ type: 'expiry', data: { timestamp: Math.floor(a.terms.expires_at_ms / 1000) } }]
      : [];
    for (const [limit, duration] of [
      [scope.max_hourly_spend, HOUR],
      [scope.max_daily_spend, DAY],
    ] as const) {
      if (!limit || !/^\d+$/.test(limit)) continue;
      out.push({
        chainId: chainIdHex(ctx.chainId),
        from: ctx.account,
        to,
        permission: {
          type: NATIVE_TOKEN_PERIODIC,
          isAdjustmentAllowed: false,
          data: { periodAmount: `0x${BigInt(limit).toString(16)}`, periodDuration: duration },
        },
        rules,
        context: permissionContext(a.agent_did),
        dependencies: [],
        delegationManager: ZERO_ADDRESS,
      });
    }
  }
  return out;
}
