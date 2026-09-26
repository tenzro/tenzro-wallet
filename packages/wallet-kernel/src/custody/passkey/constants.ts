/**
 * Canonical constants for Tenzro passkey custody. Shared with every Tenzro
 * app (web console, CLI, desktop, this wallet), so one passkey derives one
 * post-quantum key everywhere and signs in to all of them.
 */

/** WebAuthn relying party id. Configurable per deployment; `tenzro.com` by default. */
export const DEFAULT_RP_ID = 'tenzro.com';
export const DEFAULT_RP_NAME = 'Tenzro';

/** Public JSON-RPC and Web API endpoints of Tenzro Network 1. */
export const DEFAULT_RPC_URL = 'https://rpc.tenzro.xyz';
export const DEFAULT_API_URL = 'https://api.tenzro.xyz';

/** PRF input label. The salt passed to `extensions.prf.eval.first` is SHA-256 of it. */
export const PRF_SALT_LABEL = 'tenzro/passkey-prf/custody-ml-dsa-65/v1';

/** HKDF-SHA256 info string turning the PRF output into the ML-DSA-65 seed. */
export const ML_DSA_HKDF_INFO = 'tenzro/custody/ml-dsa-65/v1';

/** Domain tag of the human DID derivation (`did:tenzro:human:<uuid v8>`). */
export const HUMAN_DID_DOMAIN = 'tenzro/human-did';

/** ERC-7579 WebAuthn + ML-DSA-65 validator module installed on every passkey account. */
export const WEBAUTHN_VALIDATOR_ADDRESS = '0x0000000000000000000000000000000000001020';

export const P256_PUBLIC_KEY_BYTES = 64;
export const ML_DSA_65_PUBLIC_KEY_BYTES = 1952;
export const ML_DSA_65_SIGNATURE_BYTES = 3309;

/** Node-issued custody challenges are single-use and expire after this many seconds. */
export const CUSTODY_CHALLENGE_TTL_SECS = 300;

/** COSE algorithm id for ES256 (P-256). The only algorithm the network accepts. */
export const COSE_ES256 = -7;
