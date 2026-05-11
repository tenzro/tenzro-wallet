/**
 * Full end-to-end testnet harness for the three TDIP identity classes.
 *
 * Exercises everything the wallet kernel will do in production against the
 * live `rpc.tenzro.network` / `api.tenzro.network` endpoints:
 *
 *   1. HUMAN identity onboard (DPoP-bound JWT + auto-provisioned wallet)
 *   2. DELEGATED AGENT onboard under the human's controller DID
 *   3. AUTONOMOUS AGENT onboard (no controller; bond-funded)
 *   4. Faucet-fund the human wallet (100 TNZO)
 *   5. Resolve all three DID Documents
 *   6. Hybrid signed transfer human → agent (10 TNZO) via tenzro_signAndSendTransaction
 *   7. Hybrid signed transfer human → autonomous (5 TNZO)
 *   8. CreateEscrow (agent → autonomous payee, 2 TNZO)
 *   9. tenzro_listEscrowsByPayer / tenzro_listEscrowsByPayee assertions
 *  10. ReleaseEscrow → autonomous balance increases by 2 TNZO
 *  11. Final balance assertions across all three identities
 *
 * Each step runs as its own assertion so a transport break, an auth break,
 * or a chain break surfaces at the right line. The harness is gated on the
 * env var `TENZRO_RUN_LIVE_TESTNET=1` so vitest doesn't try to talk to the
 * live network on every CI run.
 *
 * To run:
 *   TENZRO_RUN_LIVE_TESTNET=1 pnpm --filter tenzro-wallet test \
 *     -- src/integration/identity-flow.testnet.test.ts
 */

import { createHash, generateKeyPairSync, randomBytes, sign as nodeSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// -----------------------------------------------------------------------------
// Env gate
// -----------------------------------------------------------------------------

const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const RUN_LIVE = env.TENZRO_RUN_LIVE_TESTNET === '1';

const RPC_URL = env.TENZRO_RPC_URL ?? 'https://rpc.tenzro.network';
const API_URL = env.TENZRO_API_URL ?? 'https://api.tenzro.network';
// DPoP `htu` claim. The node currently reconstructs `expected_htu` from its
// bind address (`http://<rpc_addr>/`), not from the public Caddy-fronted URL,
// so a request hitting `https://rpc.tenzro.network` is validated against
// `http://0.0.0.0:8545/`. Override with TENZRO_DPOP_HTU when the node grows
// X-Forwarded-* support.
const DPOP_HTU = env.TENZRO_DPOP_HTU ?? 'http://0.0.0.0:8545/';
const TIMEOUT_MS = Number(env.TENZRO_HARNESS_TIMEOUT_MS ?? 180_000);
const POLL_INTERVAL_MS = 2_000;

// -----------------------------------------------------------------------------
// Minimal RFC 9449 DPoP signer (Ed25519)
// -----------------------------------------------------------------------------

interface DpopKey {
  /** PKCS8 private key (Node KeyObject) */
  readonly privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
  /** Raw 32-byte Ed25519 public key, base64url-encoded for JWK `x` */
  readonly publicKeyB64u: string;
  /** RFC 7638 thumbprint of the JWK */
  readonly jkt: string;
}

function makeDpopKey(): DpopKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  // Extract raw 32-byte pubkey from SPKI
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const rawPub = spki.subarray(spki.length - 32);
  const publicKeyB64u = b64url(rawPub);
  // RFC 7638 §3.2: canonical JWK is sorted alphabetically; Ed25519 fields are
  // {crv, kty, x}.
  const jwkCanonical = JSON.stringify({ crv: 'Ed25519', kty: 'OKP', x: publicKeyB64u });
  const jkt = b64url(createHash('sha256').update(jwkCanonical).digest());
  return { privateKey, publicKeyB64u, jkt };
}

function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

interface DpopProofParams {
  readonly htm: string; // HTTP method, e.g. POST
  readonly htu: string; // HTTP target URI, e.g. https://rpc.tenzro.network
  readonly accessToken?: string; // for `ath` claim if present
}

function makeDpopProof(key: DpopKey, p: DpopProofParams): string {
  const header = {
    typ: 'dpop+jwt',
    alg: 'EdDSA',
    jwk: { crv: 'Ed25519', kty: 'OKP', x: key.publicKeyB64u },
  };
  const claims: Record<string, unknown> = {
    htm: p.htm,
    htu: p.htu,
    iat: Math.floor(Date.now() / 1000),
    jti: b64url(randomBytes(16)),
  };
  if (p.accessToken) {
    claims.ath = b64url(createHash('sha256').update(p.accessToken).digest());
  }
  const signingInput = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(claims)))}`;
  const sig = nodeSign(null, Buffer.from(signingInput), key.privateKey);
  return `${signingInput}.${b64url(sig)}`;
}

// -----------------------------------------------------------------------------
// Tiny JSON-RPC + REST clients
// -----------------------------------------------------------------------------

let rpcId = 1;

interface RpcOpts {
  readonly bearer?: string;
  readonly dpopKey?: DpopKey;
}

/**
 * JSON serializer that emits `bigint` values as raw JSON number literals,
 * not strings. Server expects `u128` fields like `CreateEscrow.amount` to
 * arrive as JSON numbers. JS `Number` loses precision above 2^53, so we
 * round-trip BigInts via a sentinel string and then strip the surrounding
 * quotes to leave the digits as a numeric literal.
 *
 * Sentinel format: `"@@bigint:<digits>@@"` — the unique prefix/suffix make
 * the strip regex unambiguous.
 */
function stringifyJsonWithBigInt(value: unknown): string {
  const sentinel = JSON.stringify(value, (_key, v) =>
    typeof v === 'bigint' ? `@@bigint:${v.toString()}@@` : v,
  );
  return sentinel.replace(/"@@bigint:(-?\d+)@@"/g, '$1');
}

async function rpc<T>(method: string, params: unknown, opts: RpcOpts = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.bearer && opts.dpopKey) {
    headers.Authorization = `DPoP ${opts.bearer}`;
    headers.DPoP = makeDpopProof(opts.dpopKey, {
      htm: 'POST',
      htu: DPOP_HTU,
      accessToken: opts.bearer,
    });
  }
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers,
    body: stringifyJsonWithBigInt({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
  if (body.error) {
    throw new Error(`RPC ${method} -> ${body.error.code}: ${body.error.message}`);
  }
  return body.result as T;
}

async function restPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

// -----------------------------------------------------------------------------
// Domain types (subset of what we actually consume)
// -----------------------------------------------------------------------------

interface OnboardSession {
  readonly identity: { readonly did: string; readonly identity_type: string; readonly status: string };
  readonly wallet: { readonly wallet_id: string; readonly address: string; readonly public_key: string };
  readonly access_token: string;
  readonly refresh_token?: string;
}

interface DidDocument {
  readonly id: string;
  readonly verificationMethod?: ReadonlyArray<{ readonly id: string; readonly type: string }>;
  readonly service?: ReadonlyArray<unknown>;
}

interface FaucetResponse {
  readonly success: boolean;
  readonly tx_hash: string | null;
  readonly amount: string;
  readonly message: string;
}

interface Identity {
  readonly label: 'human' | 'agent' | 'autonomous';
  readonly did: string;
  readonly walletId: string;
  readonly address: string;
  readonly publicKey: string;
  readonly accessToken: string;
  readonly dpopKey: DpopKey;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function waitForBalance(address: string, predicate: (wei: bigint) => boolean): Promise<bigint> {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    const hex = await rpc<string>('eth_getBalance', [address, 'latest']);
    const wei = BigInt(hex);
    if (predicate(wei)) return wei;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`waitForBalance timed out for ${address} after ${TIMEOUT_MS}ms`);
}

async function signAndSend(
  ident: Identity,
  to: string,
  valueWei: bigint,
  nonce: number,
  chainId: number,
): Promise<string> {
  return rpc<string>(
    'tenzro_signAndSendTransaction',
    {
      from: ident.address,
      to,
      value: valueWei.toString(),
      gas_limit: 21000,
      // Open lane requires gas_price >= 4× base fee (1 Gwei testnet base → 4 Gwei min).
      gas_price: 4_000_000_000,
      nonce,
      chain_id: chainId,
    },
    { bearer: ident.accessToken, dpopKey: ident.dpopKey },
  );
}

/**
 * Submit a typed `CreateEscrow` transaction. The convenience write RPCs
 * `tenzro_createEscrow` / `tenzro_releaseEscrow` were removed; escrow writes
 * flow only through `tenzro_signAndSendTransaction` / `eth_sendRawTransaction`.
 *
 * Returns the deterministic 32-byte escrow_id (hex, 0x-prefixed). The id is
 * derived client-side by replicating the VM's domain-separated hash:
 * `SHA-256("tenzro/escrow/id" || payer_bytes || nonce_u64_le)`.
 */
async function signAndSendCreateEscrow(
  ident: Identity,
  payee: string,
  amountWei: bigint,
  expiresAtMs: number,
  nonce: number,
  chainId: number,
): Promise<{ tx_hash: string; escrow_id: string }> {
  const txHash = await rpc<string>(
    'tenzro_signAndSendTransaction',
    {
      from: ident.address,
      // CreateEscrow has no natural recipient; the VM derives the vault. Pass
      // payee for parity (the VM ignores tx.to for typed escrow transactions).
      to: payee,
      value: 0,
      gas_limit: 75_000, // matches DEFAULT_ESCROW_CREATE_GAS in the CLI
      gas_price: 4_000_000_000,
      nonce,
      chain_id: chainId,
      // `TransactionType` uses serde's default externally-tagged enum form
      // (see crates/tenzro-types/src/transaction.rs:132-137 — adjacently-tagged
      // is incompatible with bincode 1.x). `ReleaseConditions::Timeout` is a
      // unit variant so it serializes as the bare string `"Timeout"`.
      // `Address(pub [u8; 32])` is a newtype around a fixed-length byte array
      // — serde renders it as a 32-element JSON array, not a hex string.
      tx_type: {
        CreateEscrow: {
          payee: Array.from(hexToBytes(payee)),
          // `amount: u128` — the server's serde rejects JSON strings for u128.
          // The custom `stringifyJsonWithBigInt` serializer in `rpc()` emits
          // BigInts as raw JSON number literals, preserving full precision.
          amount: amountWei,
          asset_id: 'TNZO',
          expires_at: expiresAtMs,
          release_conditions: 'Timeout',
        },
      },
    },
    { bearer: ident.accessToken, dpopKey: ident.dpopKey },
  );
  const escrow_id = deriveEscrowId(ident.address, nonce);
  return { tx_hash: txHash, escrow_id };
}

async function signAndSendReleaseEscrow(
  ident: Identity,
  escrowIdHex: string,
  nonce: number,
  chainId: number,
): Promise<string> {
  const escrowIdBytes = Array.from(hexToBytes(escrowIdHex));
  return rpc<string>(
    'tenzro_signAndSendTransaction',
    {
      from: ident.address,
      to: '0x0000000000000000000000000000000000000000000000000000000000000000',
      value: 0,
      gas_limit: 60_000, // matches DEFAULT_ESCROW_RELEASE_GAS in the CLI
      gas_price: 4_000_000_000,
      nonce,
      chain_id: chainId,
      tx_type: {
        ReleaseEscrow: {
          escrow_id: escrowIdBytes,
          proof: {
            proof_type: 'Cryptographic',
            proof_data: [],
            signatures: [],
            attestation: null,
          },
        },
      },
    },
    { bearer: ident.accessToken, dpopKey: ident.dpopKey },
  );
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

/** Mirror of the VM's `derive_escrow_id` — must match `tenzro-vm/src/native/mod.rs`. */
function deriveEscrowId(payerHex: string, nonce: number): string {
  const payerBytes = hexToBytes(payerHex);
  const nonceLe = new Uint8Array(8);
  // u64 little-endian
  let n = BigInt(nonce);
  for (let i = 0; i < 8; i++) {
    nonceLe[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  const h = createHash('sha256');
  h.update(Buffer.from('tenzro/escrow/id'));
  h.update(payerBytes);
  h.update(nonceLe);
  return `0x${h.digest('hex')}`;
}

// -----------------------------------------------------------------------------
// The harness
// -----------------------------------------------------------------------------

describe.skipIf(!RUN_LIVE)('integration: full identity → wallet → transfer → escrow flow', () => {
  it(
    'human / delegated agent / autonomous agent — onboard, fund, transfer, escrow, release',
    async () => {
      // --- transport sanity ---
      const chainIdHex = await rpc<string>('eth_chainId', []);
      const chainId = Number.parseInt(chainIdHex, 16);
      expect(chainId).toBe(1337);

      // -----------------------------------------------------------------------
      // Step 1 — HUMAN onboard (DPoP-bound)
      // -----------------------------------------------------------------------
      const humanDpop = makeDpopKey();
      const humanLabel = `harness-human-${Date.now()}`;
      const humanSession = await rpc<OnboardSession>('tenzro_onboardHuman', {
        display_name: humanLabel,
        dpop_jkt: humanDpop.jkt,
      });
      expect(humanSession.identity.did).toMatch(/^did:tenzro:human:[0-9a-f-]{36}$/);
      expect(humanSession.wallet.address).toMatch(/^0x[0-9a-f]{64}$/);
      expect(humanSession.access_token).toMatch(/^eyJ/);

      const human: Identity = {
        label: 'human',
        did: humanSession.identity.did,
        walletId: humanSession.wallet.wallet_id,
        address: humanSession.wallet.address,
        publicKey: humanSession.wallet.public_key,
        accessToken: humanSession.access_token,
        dpopKey: humanDpop,
      };

      // -----------------------------------------------------------------------
      // Step 2 — DELEGATED AGENT under the human's DID
      // -----------------------------------------------------------------------
      const agentDpop = makeDpopKey();
      const agentSession = await rpc<OnboardSession>('tenzro_onboardDelegatedAgent', {
        controller_did: human.did,
        capabilities: ['transfer', 'inference'],
        delegation_scope: {
          max_transaction_value: 100_000_000_000_000_000_000n.toString(), // 100 TNZO
          allowed_operations: ['transfer', 'escrow'],
        },
        dpop_jkt: agentDpop.jkt,
      });
      // Delegated machine DID embeds the controller's UUID
      const controllerUuid = human.did.split(':').pop();
      expect(agentSession.identity.did).toMatch(
        new RegExp(`^did:tenzro:machine:${controllerUuid}:[0-9a-f-]{36}$`),
      );
      const agent: Identity = {
        label: 'agent',
        did: agentSession.identity.did,
        walletId: agentSession.wallet.wallet_id,
        address: agentSession.wallet.address,
        publicKey: agentSession.wallet.public_key,
        accessToken: agentSession.access_token,
        dpopKey: agentDpop,
      };

      // -----------------------------------------------------------------------
      // Step 3 — Initial balance check (human + agent both start at 0)
      // -----------------------------------------------------------------------
      for (const ident of [human, agent]) {
        const balHex = await rpc<string>('eth_getBalance', [ident.address, 'latest']);
        expect(BigInt(balHex)).toBe(0n);
      }

      // -----------------------------------------------------------------------
      // Step 4 — Faucet-fund the human (100 TNZO). Must happen BEFORE the
      // autonomous-agent onboard, because that endpoint enforces a bond floor
      // (>= 1 TNZO at bond_funding_address) at registration time. The human's
      // freshly faucet-loaded address satisfies the floor as the bond sponsor.
      // -----------------------------------------------------------------------
      const faucetRes = await restPost<FaucetResponse>('/faucet', { address: human.address });
      expect(faucetRes.success).toBe(true);
      expect(faucetRes.amount).toBe('100 TNZO');
      const humanBalAfterFaucet = await waitForBalance(human.address, (w) => w >= 100n * 10n ** 18n);
      expect(humanBalAfterFaucet).toBe(100n * 10n ** 18n);

      // -----------------------------------------------------------------------
      // Step 5 — AUTONOMOUS agent (no controller; bond sponsored by human)
      // -----------------------------------------------------------------------
      const autonomousDpop = makeDpopKey();
      const autonomousSession = await rpc<OnboardSession>('tenzro_onboardAutonomousAgent', {
        bond_funding_address: human.address,
        dpop_jkt: autonomousDpop.jkt,
      });
      // Autonomous machine DID does NOT carry a controller segment
      expect(autonomousSession.identity.did).toMatch(/^did:tenzro:machine:[0-9a-f-]{36}$/);
      const autonomous: Identity = {
        label: 'autonomous',
        did: autonomousSession.identity.did,
        walletId: autonomousSession.wallet.wallet_id,
        address: autonomousSession.wallet.address,
        publicKey: autonomousSession.wallet.public_key,
        accessToken: autonomousSession.access_token,
        dpopKey: autonomousDpop,
      };
      // Autonomous starts at 0
      expect(BigInt(await rpc<string>('eth_getBalance', [autonomous.address, 'latest']))).toBe(0n);

      // -----------------------------------------------------------------------
      // Step 6 — Resolve all three DID Documents
      // -----------------------------------------------------------------------
      for (const ident of [human, agent, autonomous]) {
        const doc = await rpc<DidDocument>('tenzro_resolveDidDocument', { did: ident.did });
        expect(doc.id).toBe(ident.did);
        expect(doc.verificationMethod?.length ?? 0).toBeGreaterThan(0);
      }

      // -----------------------------------------------------------------------
      // Step 7 — Hybrid signed transfer human → agent (10 TNZO)
      // -----------------------------------------------------------------------
      const humanNonce0Hex = await rpc<string>('tenzro_getNonce', [human.address]);
      const humanNonce0 = Number.parseInt(humanNonce0Hex, 16);
      const txHumanToAgent = await signAndSend(
        human,
        agent.address,
        10n * 10n ** 18n,
        humanNonce0,
        chainId,
      );
      expect(txHumanToAgent).toMatch(/^[0-9a-fA-Fx]+$/);
      const agentBalAfterT1 = await waitForBalance(agent.address, (w) => w >= 10n * 10n ** 18n);
      expect(agentBalAfterT1).toBe(10n * 10n ** 18n);

      // -----------------------------------------------------------------------
      // Step 8 — Hybrid signed transfer human → autonomous (5 TNZO)
      // -----------------------------------------------------------------------
      const humanNonce1 = humanNonce0 + 1;
      const txHumanToAuto = await signAndSend(
        human,
        autonomous.address,
        5n * 10n ** 18n,
        humanNonce1,
        chainId,
      );
      expect(txHumanToAuto).toMatch(/^[0-9a-fA-Fx]+$/);
      const autoBalAfterT2 = await waitForBalance(autonomous.address, (w) => w >= 5n * 10n ** 18n);
      expect(autoBalAfterT2).toBe(5n * 10n ** 18n);

      // -----------------------------------------------------------------------
      // Step 9 — Agent CreateEscrow(payee=autonomous, amount=2 TNZO) via
      // typed transaction. The convenience write RPCs were removed; escrow
      // writes flow through tenzro_signAndSendTransaction only.
      // -----------------------------------------------------------------------
      const escrowAmount = 2n * 10n ** 18n;
      const expiresAtMs = Date.now() + 3600_000;
      const agentNonce0Hex = await rpc<string>('tenzro_getNonce', [agent.address]);
      const agentNonce0 = Number.parseInt(agentNonce0Hex, 16);
      const escrowResult = await signAndSendCreateEscrow(
        agent,
        autonomous.address,
        escrowAmount,
        expiresAtMs,
        agentNonce0,
        chainId,
      );
      expect(escrowResult.escrow_id).toMatch(/^0x[0-9a-f]{64}$/);

      // -----------------------------------------------------------------------
      // Step 10 — Wait for the escrow to appear in payer + payee indexes
      // (read RPCs hit RocksDB after the tx finalizes; poll up to 30s).
      // -----------------------------------------------------------------------
      const escrowDeadline = Date.now() + 30_000;
      let byPayer: Array<{ escrow_id: string; payee: string; amount: string }> = [];
      let byPayee: Array<{ escrow_id: string; payer: string }> = [];
      while (Date.now() < escrowDeadline) {
        const payerResp = await rpc<{
          payer: string;
          count: number;
          escrows: Array<{ escrow_id: string; payee: string; amount: string }>;
        }>('tenzro_listEscrowsByPayer', [{ payer: agent.address }]);
        const payeeResp = await rpc<{
          payee: string;
          count: number;
          escrows: Array<{ escrow_id: string; payer: string }>;
        }>('tenzro_listEscrowsByPayee', [{ payee: autonomous.address }]);
        byPayer = payerResp.escrows;
        byPayee = payeeResp.escrows;
        if (
          byPayer.some((e) => e.escrow_id === escrowResult.escrow_id) &&
          byPayee.some((e) => e.escrow_id === escrowResult.escrow_id)
        )
          break;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      expect(byPayer.some((e) => e.escrow_id === escrowResult.escrow_id)).toBe(true);
      expect(byPayee.some((e) => e.escrow_id === escrowResult.escrow_id)).toBe(true);

      // -----------------------------------------------------------------------
      // Step 11 — Agent releases escrow via typed ReleaseEscrow tx →
      // autonomous balance += 2 TNZO
      // -----------------------------------------------------------------------
      const agentNonce1 = agentNonce0 + 1;
      await signAndSendReleaseEscrow(agent, escrowResult.escrow_id, agentNonce1, chainId);
      const autoBalAfterRelease = await waitForBalance(
        autonomous.address,
        (w) => w >= 5n * 10n ** 18n + escrowAmount,
      );
      expect(autoBalAfterRelease).toBe(7n * 10n ** 18n);

      // -----------------------------------------------------------------------
      // Step 12 — Final balance assertions
      // -----------------------------------------------------------------------
      const humanFinalBal = BigInt(await rpc<string>('eth_getBalance', [human.address, 'latest']));
      const agentFinalBal = BigInt(await rpc<string>('eth_getBalance', [agent.address, 'latest']));
      const autoFinalBal = BigInt(await rpc<string>('eth_getBalance', [autonomous.address, 'latest']));

      // human spent 15 TNZO (10 to agent + 5 to autonomous), modulo gas
      expect(humanFinalBal).toBeLessThan(85n * 10n ** 18n);
      expect(humanFinalBal).toBeGreaterThan(80n * 10n ** 18n);
      // agent received 10, escrowed 2, gas: ~7.99 TNZO left
      expect(agentFinalBal).toBeLessThan(8n * 10n ** 18n);
      expect(agentFinalBal).toBeGreaterThan(7n * 10n ** 18n);
      // autonomous received 5 + 2 from escrow release = 7 TNZO
      expect(autoFinalBal).toBe(7n * 10n ** 18n);

      // Print a summary that pipes into vitest's stdout for a human-readable
      // record of the run (handy when debugging an intermittent failure).
      // eslint-disable-next-line no-console
      console.log(
        '\n===== identity-flow.testnet summary =====\n' +
          `human:      ${human.did}\n  address:  ${human.address}\n  balance:  ${humanFinalBal} wei\n` +
          `agent:      ${agent.did}\n  address:  ${agent.address}\n  balance:  ${agentFinalBal} wei\n` +
          `autonomous: ${autonomous.did}\n  address:  ${autonomous.address}\n  balance:  ${autoFinalBal} wei\n` +
          `escrow_id:  ${escrowResult.escrow_id}\n` +
          '=========================================\n',
      );
    },
    TIMEOUT_MS + 30_000,
  );
});
