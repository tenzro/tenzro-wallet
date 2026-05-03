export { internalMpcDriver } from './internal-mpc.ts';
export type { InternalMpcOptions } from './internal-mpc.ts';

// ── FROST device drivers (M5) ──
export * from './frost/index.ts';

// ── ML-DSA-65 driver + coordinator (M5) ──
export * from './mldsa/index.ts';

// ── Passkey share-unwrap (M5) ──
export * from './passkey-share/index.ts';

// ── SurfaceKey wire identifier ──
export { surfaceKeyId } from './surface-key-id.ts';

export type {
  PairingPort,
  PairingState,
  PairingStartRequest,
  PairingStartResult,
  PairingPollResult,
  PairingClaimRequest,
  PairingClaimResult,
  PairingFinalizeRequest,
  PairingFinalizeResult,
  PasskeyAssertion,
  VerificationMethod,
  PairingHttpConfig,
} from './pairing/index.ts';
export { PairingHttpAdapter, PairingHttpError } from './pairing/index.ts';
