/**
 * Tenzro testnet endpoints. The RPC is open-CORS and serves the
 * JSON-RPC 2.0 surface; the API host carries side helpers like the
 * faucet that aren't part of the consensus RPC.
 */

export const TENZRO_RPC_URL = 'https://rpc.tenzro.network';
export const TENZRO_API_URL = 'https://api.tenzro.network';
export const TENZRO_CHAIN_ID = 1337;
export const TENZRO_NETWORK_NAME = 'Tenzro Testnet';

/**
 * The DPoP `htu` claim must equal the URL the server sees itself as,
 * which is its internal bind address — not the public RPC URL we
 * post to. Verified by the rpc.tenzro.network server rejecting
 * proofs with `htu=https://rpc.tenzro.network` and accepting
 * `htu=http://0.0.0.0:8545/`. Matches the `iss` claim on issued JWTs.
 */
export const TENZRO_DPOP_HTU = 'http://0.0.0.0:8545/';
