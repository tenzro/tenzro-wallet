/**
 * TeeAttestationSdkAdapter — wraps the SDK's `TeeClient` (read-only slice).
 * The wallet doesn't seal/unseal data through the TEE itself; it only
 * needs detect / getAttestation / verify for the trust-bootstrap flow.
 */

import type { TeeClient } from 'tenzro-sdk';
import type {
  AttestationReport,
  AttestationVerifyResult,
  TeeAttestationPort,
  TeeInfo,
} from '../tee-attestation.ts';

export interface TeeClientLike {
  detectTee(): Promise<{
    available: boolean;
    vendor: string;
    capabilities: string[];
  }>;
  getAttestation(teeType: string): Promise<{
    report: string;
    signature: string;
    certificate_chain: string[];
  }>;
  verifyAttestation(
    attestation: string,
    teeType: string,
  ): Promise<{ valid: boolean; message?: string }>;
}

export class TeeAttestationSdkAdapter implements TeeAttestationPort {
  constructor(private readonly client: TeeClientLike) {}

  static fromClient(client: TeeClient): TeeAttestationSdkAdapter {
    return new TeeAttestationSdkAdapter(client as unknown as TeeClientLike);
  }

  async detect(): Promise<TeeInfo> {
    const raw = await this.client.detectTee();
    return {
      available: raw.available,
      vendor: raw.vendor,
      capabilities: raw.capabilities,
    };
  }

  async getAttestation(teeType: string): Promise<AttestationReport> {
    const raw = await this.client.getAttestation(teeType);
    return {
      report: raw.report,
      signature: raw.signature,
      certificateChain: raw.certificate_chain,
    };
  }

  async verify(attestationHex: string, teeType: string): Promise<AttestationVerifyResult> {
    const raw = await this.client.verifyAttestation(attestationHex, teeType);
    return {
      valid: raw.valid,
      ...(raw.message !== undefined ? { message: raw.message } : {}),
    };
  }
}
