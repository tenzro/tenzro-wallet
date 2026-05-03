/**
 * QR pairing flow for upgrading 2-of-2 → 2-of-3 by adding a second user
 * device (DESIGN.md §4.3.6). The `PairingPort` is the kernel-facing
 * surface; the `PairingHttpAdapter` is the real driver against a Tenzro
 * RPC node's `/wallet/pairing/*` endpoints.
 */

export type {
  PasskeyAssertion,
  PairingPort,
  PairingState,
  PairingStartRequest,
  PairingStartResult,
  PairingPollResult,
  PairingClaimRequest,
  PairingClaimResult,
  PairingFinalizeRequest,
  PairingFinalizeResult,
  VerificationMethod,
} from './port.ts';

export { PairingHttpAdapter, PairingHttpError } from './http-adapter.ts';
export type { PairingHttpConfig } from './http-adapter.ts';
