/**
 * TeeAttestationPort — verify the node's TEE attestation.
 *
 * The wallet's hybrid-signing path leans on a TEE-resident co-signer at
 * the Tenzro node. Before trusting that co-signer (in particular before
 * sending a passkey-derived share to it), the wallet should verify the
 * node's attestation report against the TEE vendor's certificate chain.
 *
 * The wallet does NOT itself decode TDX/SEV/Nitro reports — that's a
 * mountain of vendor-specific code, with cert chains that need keeping
 * up to date. Instead the node exposes verification as an RPC
 * (`tenzro_verifyTeeAttestation`); the wallet calls in. Trust model:
 * the same engine that issues the attestation also verifies it, which
 * isn't useful in isolation. The protection comes from the wallet
 * pinning the node's expected vendor + measurement off-band (e.g. via a
 * release manifest) and then checking the attestation result *and* the
 * report's measurement field against that pin.
 *
 * This port surfaces:
 *   - `detect`         — what TEE the node says it has
 *   - `getAttestation` — fetch a fresh attestation report
 *   - `verify`         — verify an attestation (typically the one just fetched)
 *
 * The wallet UI uses these to render a "verified" badge and to gate
 * sensitive flows on a green attestation.
 */

export interface TeeInfo {
  readonly available: boolean;
  /** "intel-tdx", "amd-sev-snp", "aws-nitro", "nvidia-gpu". */
  readonly vendor: string;
  readonly capabilities: readonly string[];
}

export interface AttestationReport {
  /** Hex-encoded report bytes. The wallet treats these as opaque except
   *  for pinning-time measurement comparisons. */
  readonly report: string;
  /** Hex-encoded vendor signature over `report`. */
  readonly signature: string;
  /** X.509 certificate chain (PEM strings). */
  readonly certificateChain: readonly string[];
}

export interface AttestationVerifyResult {
  readonly valid: boolean;
  readonly message?: string;
}

export interface TeeAttestationPort {
  detect(): Promise<TeeInfo>;
  getAttestation(teeType: string): Promise<AttestationReport>;
  verify(attestationHex: string, teeType: string): Promise<AttestationVerifyResult>;
}
