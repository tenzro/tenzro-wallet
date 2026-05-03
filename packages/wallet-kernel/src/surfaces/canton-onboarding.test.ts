/**
 * Tests for the Canton external-party onboarding ceremony. Drives the full
 * 8-step flow against a recording in-memory `CantonValidatorPort`; the
 * critical assertions are that
 *   (a) the wallet recomputes the bundle hash and refuses to sign on mismatch,
 *   (b) the wallet recomputes the accept-setup hash and refuses to sign on
 *       mismatch,
 *   (c) the validator sees the namespace public key + signing keys + threshold
 *       in `generateTopology`,
 *   (d) the namespace signature is what flows into `submitTopology`.
 */

import { describe, expect, it } from 'vitest';
import { internalMpcDriver } from '../custody/internal-mpc.ts';
import { provisionIdentity } from '../identity/provision.ts';
import {
  preparedTransactionHash,
  topologyBundleHash,
} from '../ports/canton/hash.ts';
import type {
  CantonValidatorPort,
  GenerateTopologyRequest,
  GenerateTopologyResponse,
  PrepareAcceptSetupRequest,
  PrepareAcceptSetupResponse,
  SubmitAcceptSetupRequest,
  SubmitTopologyRequest,
} from '../ports/canton/canton-validator.ts';
import { onboardExternalParty } from './canton-onboarding.ts';

interface Recording {
  generateTopologyCalls: GenerateTopologyRequest[];
  submitTopologyCalls: SubmitTopologyRequest[];
  setupProposalCalls: { partyId: string }[];
  prepareAcceptSetupCalls: PrepareAcceptSetupRequest[];
  submitAcceptSetupCalls: SubmitAcceptSetupRequest[];
}

interface PortOpts {
  /** Override the bundle hash returned by `generateTopology` to simulate a
   *  malicious validator. Default: real hash of the bundle. */
  readonly tamperedBundleHash?: Uint8Array;
  /** Override the accept-setup hash. Default: real hash. */
  readonly tamperedAcceptHash?: Uint8Array;
}

async function recordingPort(
  opts: PortOpts = {},
): Promise<{ port: CantonValidatorPort; recording: Recording }> {
  const recording: Recording = {
    generateTopologyCalls: [],
    submitTopologyCalls: [],
    setupProposalCalls: [],
    prepareAcceptSetupCalls: [],
    submitAcceptSetupCalls: [],
  };
  const topologyTxs = [
    new Uint8Array([0xaa, 0x01]),
    new Uint8Array([0xaa, 0x02]),
    new Uint8Array([0xaa, 0x03]),
  ];
  const acceptTx = new Uint8Array([0xbb, 0x01, 0x02]);
  const realBundleHash = await topologyBundleHash(topologyTxs);
  const realAcceptHash = await preparedTransactionHash(acceptTx);

  const port: CantonValidatorPort = {
    prepareSubmission: async () => {
      throw new Error('not used in onboarding');
    },
    executeSubmission: async () => {
      throw new Error('not used in onboarding');
    },
    tailCompletions: async function* () {},
    getActiveContracts: async function* () {},
    lookupPreapproval: async () => null,
    resolveCns: async () => null,
    generateTopology: async (req): Promise<GenerateTopologyResponse> => {
      recording.generateTopologyCalls.push(req);
      return {
        topologyTransactions: topologyTxs,
        bundleHash: opts.tamperedBundleHash ?? realBundleHash,
        partyId: 'alice::1220abcdef',
      };
    },
    submitTopology: async (req) => {
      recording.submitTopologyCalls.push(req);
    },
    setupProposal: async (req) => {
      recording.setupProposalCalls.push(req);
    },
    prepareAcceptSetup: async (
      req: PrepareAcceptSetupRequest,
    ): Promise<PrepareAcceptSetupResponse> => {
      recording.prepareAcceptSetupCalls.push(req);
      return {
        preparedTransaction: acceptTx,
        preparedTransactionHash: opts.tamperedAcceptHash ?? realAcceptHash,
        hashingSchemeVersion: 'HASHING_SCHEME_VERSION_V2',
      };
    },
    submitAcceptSetup: async (req) => {
      recording.submitAcceptSetupCalls.push(req);
    },
  };
  return { port, recording };
}

describe('onboardExternalParty', () => {
  it('drives the full ceremony and threads the namespace signature into submitTopology', async () => {
    const identity = await provisionIdentity({ uuid: 'onboarding-1' });
    const { port, recording } = await recordingPort();
    const result = await onboardExternalParty(
      { keyResolver: (d) => (d === identity.did ? identity.keys.get('canton-external') : undefined), signingDriver: internalMpcDriver(), validatorPort: port },
      { did: identity.did, surface: 'canton-external', partyHint: 'alice' },
    );

    expect(result.partyId).toBe('alice::1220abcdef');

    // generateTopology saw the real namespace + signing keys + threshold.
    expect(recording.generateTopologyCalls).toHaveLength(1);
    const gen = recording.generateTopologyCalls[0]!;
    const externalKey = identity.keys.get('canton-external');
    if (!externalKey || externalKey.surface !== 'canton-external') {
      throw new Error('no canton-external key on test identity');
    }
    expect(gen.threshold).toBe(externalKey.threshold);
    expect([...gen.namespacePublicKey]).toEqual([...externalKey.namespaceKey.publicKey]);
    expect(gen.signingPublicKeys).toHaveLength(externalKey.signingKeys.length);

    // submitTopology forwarded the same topology bytes + a real signature.
    expect(recording.submitTopologyCalls).toHaveLength(1);
    const subT = recording.submitTopologyCalls[0]!;
    expect(subT.topologyTransactions).toHaveLength(3);
    expect(subT.namespaceSignature.length).toBeGreaterThan(0);

    // setupProposal + prepareAcceptSetup + submitAcceptSetup each ran once.
    expect(recording.setupProposalCalls).toEqual([{ partyId: 'alice::1220abcdef' }]);
    expect(recording.prepareAcceptSetupCalls).toEqual([{ partyId: 'alice::1220abcdef' }]);
    expect(recording.submitAcceptSetupCalls).toHaveLength(1);
    expect(recording.submitAcceptSetupCalls[0]!.hashingSchemeVersion).toBe(
      'HASHING_SCHEME_VERSION_V2',
    );
  });

  it('refuses to sign when the validator returns a tampered bundle hash', async () => {
    const identity = await provisionIdentity({ uuid: 'onboarding-tamper-1' });
    const { port } = await recordingPort({
      tamperedBundleHash: new Uint8Array(32), // 32 zero bytes — definitely not the real hash
    });
    await expect(
      onboardExternalParty(
        { keyResolver: (d) => (d === identity.did ? identity.keys.get('canton-external') : undefined), signingDriver: internalMpcDriver(), validatorPort: port },
        { did: identity.did, surface: 'canton-external', partyHint: 'mallory' },
      ),
    ).rejects.toThrow(/topology bundle hash mismatch/);
  });

  it('refuses to sign when the validator returns a tampered accept-setup hash', async () => {
    const identity = await provisionIdentity({ uuid: 'onboarding-tamper-2' });
    const { port } = await recordingPort({
      tamperedAcceptHash: new Uint8Array(32),
    });
    await expect(
      onboardExternalParty(
        { keyResolver: (d) => (d === identity.did ? identity.keys.get('canton-external') : undefined), signingDriver: internalMpcDriver(), validatorPort: port },
        { did: identity.did, surface: 'canton-external', partyHint: 'mallory' },
      ),
    ).rejects.toThrow(/accept-setup preparedTransactionHash mismatch/);
  });

  it('rejects when the resolved key is for the wrong canton surface', async () => {
    const identity = await provisionIdentity({ uuid: 'onboarding-surface-mismatch' });
    const { port } = await recordingPort();
    await expect(
      onboardExternalParty(
        { keyResolver: (d) => (d === identity.did ? identity.keys.get('tenzro-native') : undefined), signingDriver: internalMpcDriver(), validatorPort: port },
        { did: identity.did, surface: 'canton-external', partyHint: 'alice' },
      ),
    ).rejects.toThrow(/no canton-external key/);
  });
});
