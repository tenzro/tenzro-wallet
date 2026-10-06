'use client';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Logo,
} from '@tenzro/ui';
import * as React from 'react';
import {
  POPUP_ERRORS,
  POPUP_PROTOCOL,
  type PopupApproveAgentTerms,
  type PopupLinkCredential,
  type PopupRequest,
  type PopupResponse,
  type PopupSendTransaction,
  type PopupSignSettlementPlan,
  isPopupRequest,
} from 'tenzro-wallet';
import {
  type OwnershipProof,
  type PasskeyEntryOptions,
  type StepUpRequest,
  hexToBytes,
  parseStepUpRequest,
} from 'tenzro-wallet/custody';

import { LinkDeviceActions } from '@/components/wallet/link-device';
import { PlanReview } from '@/components/wallet/plan-review';
import { StepUpReview } from '@/components/wallet/step-up-review';
import { TermsReview } from '@/components/wallet/terms-review';
import { approveStepUp } from '@/lib/tenzro/agents';
import { ensureAgentBond } from '@/lib/tenzro/agents';
import { addConnection, isConnected, removeConnection } from '@/lib/tenzro/connections';
import { TNZO_DECIMALS, formatBaseUnits, shortAddress } from '@/lib/tenzro/format';
import { usePlatformPasskey, useWallet } from '@/lib/tenzro/hooks';
import { signTransaction } from '@/lib/tenzro/native-tx';
import { type EnteredWallet, custody, sendTnzo } from '@/lib/tenzro/wallet';

interface Pending {
  readonly request: PopupRequest;
  readonly origin: string;
}

/** The site's one-time challenge for an ownership proof, if it sent one. */
function connectChallenge(request: PopupRequest): Uint8Array | undefined {
  const challenge = (request.params as { challenge?: unknown } | undefined)?.challenge;
  if (challenge === undefined) return undefined;
  if (typeof challenge !== 'string' || !/^(0x)?([0-9a-fA-F]{2}){16,64}$/.test(challenge)) {
    throw new Error('The site sent an invalid challenge.');
  }
  return hexToBytes(challenge);
}

function isPlan(p: unknown): p is PopupSignSettlementPlan {
  const plan = (p as Partial<PopupSignSettlementPlan> | null)?.plan;
  return (
    !!plan &&
    Number.isInteger(plan.nonce) &&
    typeof plan.quote_digest === 'string' &&
    typeof plan.split_hash === 'string' &&
    Array.isArray(plan.split?.lines) &&
    Array.isArray(plan.legs) &&
    plan.legs.length >= 1 &&
    plan.legs.length <= 16 &&
    Number.isInteger(plan.decide_deadline_ms)
  );
}

function isTerms(p: unknown): p is PopupApproveAgentTerms {
  const v = p as Partial<PopupApproveAgentTerms> | null;
  return (
    !!v &&
    (v.operation === 'delegate_agent' || v.operation === 'update_agent_terms') &&
    typeof v.terms?.agent_name === 'string' &&
    Array.isArray(v.terms.serving_nodes) &&
    typeof v.challenge?.challenge_id === 'string' &&
    typeof v.challenge.challenge_hex === 'string'
  );
}

function stepUp(p: unknown): StepUpRequest | null {
  try {
    return parseStepUpRequest(p);
  } catch {
    return null;
  }
}

type LinkParams = PopupLinkCredential & {
  readonly update: PopupLinkCredential['update'] & {
    readonly op: {
      readonly add_credential: { readonly credential: { rp_id: string; label: string } };
    };
  };
};

function isLink(p: unknown): p is LinkParams {
  const u = (p as { update?: { account?: unknown; op?: unknown } } | undefined)?.update;
  const cred = (u?.op as { add_credential?: { credential?: { rp_id?: unknown } } } | undefined)
    ?.add_credential?.credential;
  return typeof u?.account === 'string' && typeof cred?.rp_id === 'string';
}

function isSend(p: unknown): p is PopupSendTransaction {
  const v = p as Partial<PopupSendTransaction> | null;
  return !!v && typeof v.to === 'string' && typeof v.value === 'string' && /^\d+$/.test(v.value);
}

export default function ApprovePage() {
  const { wallet, signIn, create, loading, error: walletError } = useWallet();
  const [name, setName] = React.useState('');
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [noOpener, setNoOpener] = React.useState(false);
  const platform = usePlatformPasskey();
  const [phoneChosen, setPhoneChosen] = React.useState(false);
  const phone = phoneChosen || platform === false;
  // A wallet created here, held back from the site while a second device is offered.
  const [created, setCreated] = React.useState<EnteredWallet | null>(null);
  const [deviceName, setDeviceName] = React.useState('');

  const respond = React.useCallback(
    (body: Omit<PopupResponse, 'protocol' | 'type' | 'id'>) => {
      if (!pending || !window.opener) return;
      const msg: PopupResponse = {
        protocol: POPUP_PROTOCOL,
        type: 'response',
        id: pending.request.id,
        ...body,
      };
      // Only the site that asked receives the answer.
      (window.opener as Window).postMessage(msg, pending.origin);
      setPending(null);
    },
    [pending],
  );

  React.useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) {
      setNoOpener(true);
      return;
    }
    const onMessage = (e: MessageEvent) => {
      if (e.source !== opener || !isPopupRequest(e.data)) return;
      setPending((cur) => cur ?? { request: e.data as PopupRequest, origin: e.origin });
    };
    window.addEventListener('message', onMessage);
    // The ready signal carries nothing, so it may go to whichever page opened us.
    opener.postMessage({ protocol: POPUP_PROTOCOL, type: 'ready' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Disconnecting needs no approval, only the wallet that holds the connection.
  React.useEffect(() => {
    if (pending?.request.method === 'tenzro_disconnect' && wallet) {
      removeConnection(pending.origin, wallet.account);
      respond({ result: null });
      window.close();
    }
  }, [pending, wallet, respond]);

  async function approve() {
    if (!pending || !wallet) return;
    setBusy(true);
    setError(null);
    try {
      const { method, params } = pending.request;
      if (method === 'tenzro_connect') {
        const challenge = connectChallenge(pending.request);
        const proof: OwnershipProof | undefined = challenge
          ? await custody().proveOwnership(wallet, challenge)
          : undefined;
        addConnection(pending.origin, wallet.account);
        respond({
          result: { account: wallet.account, did: wallet.did, ...(proof ? { proof } : {}) },
        });
      } else if (method === 'tenzro_addWallet') {
        const salt = (params as { salt?: unknown } | undefined)?.salt;
        if (typeof salt !== 'number' || !Number.isInteger(salt) || salt < 1) {
          throw new Error('The site asked for an invalid wallet.');
        }
        const added = await custody().addWallet(wallet, { salt });
        respond({
          result: {
            account: added.account,
            did: added.did,
            salt,
            ...(added.anchor ? { anchor: added.anchor } : {}),
          },
        });
      } else if (method === 'tenzro_sendTransaction') {
        if (!isSend(params)) throw new Error('The site sent an invalid transaction.');
        const { txHash } = await sendTnzo(wallet, params.to, BigInt(params.value));
        respond({ result: { txHash } });
      } else if (method === 'tenzro_signSettlementPlan') {
        if (!isPlan(params)) throw new Error('The site sent an invalid settlement plan.');
        const signedTx = await signTransaction(wallet, {
          kind: 'SettlementPlan',
          fields: { op: { open: params.plan } },
        });
        respond({ result: { signedTx } });
      } else if (method === 'tenzro_approveAgentTerms') {
        if (!isTerms(params)) throw new Error('The site sent invalid Terms.');
        // The network refuses Terms the agent's bond does not cover: post or
        // top it up from this account first, signed by this passkey.
        const agentDid = (params.challenge as { agent_did?: string }).agent_did;
        if (agentDid) {
          await ensureAgentBond(wallet, agentDid, params.terms.delegation_scope ?? {});
        }
        const authorization = await custody().approveAgentTerms(wallet, {
          operation: params.operation,
          terms: params.terms,
          ...(params.rotate_tokens !== undefined ? { rotateTokens: params.rotate_tokens } : {}),
          challenge: params.challenge,
        });
        respond({ result: { authorization } });
      } else if (method === 'tenzro_linkCredential') {
        if (!isLink(params)) throw new Error('The site sent an invalid passkey link.');
        const linked = await custody().approveLink(wallet, params.update);
        respond({ result: { credentialsTotal: linked.credentials_total } });
      } else if (method === 'tenzro_approveAgentAction') {
        const request = parseStepUpRequest(params);
        respond({ result: { step_up: await approveStepUp(wallet, request) } });
      }
      window.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Answers a connect request with a wallet just entered here: no second approval. */
  function connectWith(w: EnteredWallet) {
    if (!pending) return;
    addConnection(pending.origin, w.account);
    respond({ result: { account: w.account, did: w.did, ...(w.proof ? { proof: w.proof } : {}) } });
    window.close();
  }

  /**
   * Signing in or creating on a connect request is the consent to connect, so
   * the approval that opens the wallet also signs the site's challenge.
   */
  async function enter(kind: 'sign-in' | 'create') {
    if (!pending) return;
    setError(null);
    try {
      const isConnect = pending.request.method === 'tenzro_connect';
      const challenge = isConnect ? connectChallenge(pending.request) : undefined;
      const opts: PasskeyEntryOptions = {
        ...(challenge ? { challenge } : {}),
        ...(phone ? { hints: ['hybrid'] as const } : {}),
      };
      const w =
        kind === 'create' ? await create(name.trim() || 'Tenzro wallet', opts) : await signIn(opts);
      if (!isConnect) return;
      // Creating on a device that already held a Tenzro passkey opened that
      // wallet instead: connect it as a sign-in would.
      if (kind === 'create' && !('existing' in w && w.existing)) setCreated(w);
      else connectWith(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function decline() {
    respond({ error: { code: POPUP_ERRORS.rejected, message: 'The request was declined.' } });
    window.close();
  }

  const connected = pending && wallet ? isConnected(pending.origin, wallet.account) : false;
  const needsConnection =
    (pending?.request.method === 'tenzro_sendTransaction' ||
      pending?.request.method === 'tenzro_signSettlementPlan' ||
      pending?.request.method === 'tenzro_approveAgentTerms' ||
      pending?.request.method === 'tenzro_approveAgentAction' ||
      pending?.request.method === 'tenzro_addWallet' ||
      pending?.request.method === 'tenzro_linkDevice') &&
    !connected;

  // The site may suggest a name for the new device; the person can change it.
  React.useEffect(() => {
    if (pending?.request.method !== 'tenzro_linkDevice') return;
    const label = (pending.request.params as { label?: unknown } | undefined)?.label;
    if (typeof label === 'string') setDeviceName(label.slice(0, 40));
  }, [pending]);

  React.useEffect(() => {
    if (needsConnection && pending) {
      respond({
        error: {
          code: POPUP_ERRORS.unauthorized,
          message: 'Connect this site to the wallet first.',
        },
      });
    }
  }, [needsConnection, pending, respond]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
      <Logo />
      {noOpener ? (
        <p className="text-sm text-foreground-muted">
          This page answers requests from sites that use Tenzro Wallet. Open it from such a site.
        </p>
      ) : !pending ? (
        <p className="text-sm text-foreground-muted">Waiting for the site's request…</p>
      ) : created ? (
        <Card variant="raised">
          <CardHeader>
            <CardTitle>Your wallet is ready</CardTitle>
            <CardDescription>
              Add a second device now, so losing this one never locks you out. You can also do it
              later in Settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <LinkDeviceActions onLinked={() => connectWith(created)} />
            <Button variant="ghost" onClick={() => connectWith(created)}>
              Later, continue to <span className="font-mono">{new URL(pending.origin).host}</span>
            </Button>
          </CardContent>
        </Card>
      ) : !wallet ? (
        <Card variant="raised">
          <CardHeader>
            <CardTitle>Your Tenzro wallet</CardTitle>
            <CardDescription>
              <span className="font-mono">{pending.origin}</span> wants to use your Tenzro wallet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button width="full" onClick={() => enter('sign-in')} disabled={loading}>
              Sign in with your passkey
            </Button>
            <p className="text-sm text-foreground-muted">
              New to Tenzro? Create a wallet with a passkey.
            </p>
            <Input
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
            />
            <Button
              width="full"
              variant="outline"
              onClick={() => enter('create')}
              disabled={loading}
            >
              Create a wallet
            </Button>
            {phone ? (
              <p className="text-sm text-foreground-muted">
                {platform === false ? 'This device cannot hold a passkey. ' : ''}A QR code will
                appear: scan it with your phone and approve there.
              </p>
            ) : (
              <button
                type="button"
                className="block w-full text-center text-sm text-foreground-muted underline underline-offset-2"
                onClick={() => setPhoneChosen(true)}
              >
                Use a phone instead (QR code)
              </button>
            )}
            {pending.request.method === 'tenzro_connect' && (
              <p className="text-xs text-foreground-subtle">
                Signing in connects this site: it will see your address and identity, and cannot
                move funds without your approval.
              </p>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
          </CardContent>
        </Card>
      ) : pending.request.method === 'tenzro_disconnect' ? null : pending.request.method ===
        'tenzro_linkDevice' ? (
        <Card variant="raised">
          <CardHeader>
            <CardTitle>Add a device</CardTitle>
            <CardDescription>
              <span className="font-mono">{pending.origin}</span> asks you to add a device to your
              wallet <span className="font-mono">{shortAddress(wallet.account)}</span>. Any linked
              device can open and approve for it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder="Device name, e.g. Phone"
              maxLength={40}
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
            />
            <LinkDeviceActions
              label={deviceName}
              onLinked={(linked) => {
                respond({
                  result: {
                    credentialsTotal: linked.credentials_total,
                    alreadyLinked: linked.already_linked === true,
                  },
                });
                // A device that already held the passkey gets the explanation before the window closes.
                if (!linked.already_linked) window.close();
              }}
            />
            <Button variant="ghost" onClick={decline}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card variant="raised">
          <CardHeader>
            <CardTitle>
              {pending.request.method === 'tenzro_connect'
                ? 'Connect to this site?'
                : pending.request.method === 'tenzro_addWallet'
                  ? 'Add a wallet?'
                  : pending.request.method === 'tenzro_signSettlementPlan'
                    ? 'Review this settlement plan'
                    : pending.request.method === 'tenzro_approveAgentTerms'
                      ? 'Approve these Terms for an agent?'
                      : pending.request.method === 'tenzro_approveAgentAction'
                        ? 'Your agent asks you to approve this action'
                        : pending.request.method === 'tenzro_linkCredential'
                          ? 'Link a passkey to your wallet?'
                          : 'Approve this payment?'}
            </CardTitle>
            <CardDescription>
              <span className="font-mono">{pending.origin}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {pending.request.method === 'tenzro_connect' ? (
              <p className="text-foreground-muted">
                The site will see your address{' '}
                <span className="font-mono">{shortAddress(wallet.account)}</span> and your identity,
                and may ask you to approve payments. It cannot move funds without your approval.
              </p>
            ) : pending.request.method === 'tenzro_addWallet' ? (
              <p className="text-foreground-muted">
                Creates another wallet under your identity{' '}
                <span className="font-mono">{wallet.did}</span>, approved with your passkey. The
                site learns the new wallet's address.
              </p>
            ) : pending.request.method === 'tenzro_approveAgentTerms' ? (
              isTerms(pending.request.params) ? (
                <>
                  <TermsReview terms={pending.request.params.terms} />
                  <p className="text-foreground-muted">
                    {pending.request.params.operation === 'delegate_agent'
                      ? 'The agent acts on your behalf within these Terms, on every node, until you revoke it.'
                      : "These Terms replace the agent's current ones on every node."}{' '}
                    The passkey your identity was created with approves them.
                  </p>
                </>
              ) : (
                <p className="text-danger">The site sent invalid Terms.</p>
              )
            ) : pending.request.method === 'tenzro_approveAgentAction' ? (
              (() => {
                const req = stepUp(pending.request.params);
                return req ? (
                  <>
                    <StepUpReview action={req.action} />
                    <p className="text-foreground-muted">
                      The agent's Terms hold this action for you. Approving lets it take this one
                      action, nothing else.
                    </p>
                  </>
                ) : (
                  <p className="text-danger">The site sent an invalid action.</p>
                );
              })()
            ) : pending.request.method === 'tenzro_linkCredential' ? (
              isLink(pending.request.params) ? (
                <p className="text-foreground-muted">
                  Links the passkey{' '}
                  <span className="font-medium text-foreground">
                    {pending.request.params.update.op.add_credential.credential.label || 'passkey'}
                  </span>{' '}
                  made at{' '}
                  <span className="font-mono">
                    {pending.request.params.update.op.add_credential.credential.rp_id}
                  </span>{' '}
                  to your wallet <span className="font-mono">{shortAddress(wallet.account)}</span>.
                  It can then approve for your wallet like your other devices. Approved with your
                  passkey; you can remove it in Settings.
                </p>
              ) : (
                <p className="text-danger">The site sent an invalid passkey link.</p>
              )
            ) : pending.request.method === 'tenzro_signSettlementPlan' ? (
              isPlan(pending.request.params) ? (
                <PlanReview plan={pending.request.params.plan} />
              ) : (
                <p className="text-danger">The site sent an invalid settlement plan.</p>
              )
            ) : isSend(pending.request.params) ? (
              <div className="space-y-1">
                <p className="font-mono text-xl tabular">
                  {formatBaseUnits(pending.request.params.value, TNZO_DECIMALS)} TNZO
                </p>
                <p className="text-foreground-muted">
                  to <span className="font-mono">{pending.request.params.to}</span>
                </p>
              </div>
            ) : (
              <p className="text-danger">The site sent an invalid transaction.</p>
            )}
            <div className="flex gap-2">
              <Button onClick={approve} disabled={busy}>
                {busy ? 'Approve with your passkey…' : 'Approve'}
              </Button>
              <Button variant="outline" onClick={decline} disabled={busy}>
                Decline
              </Button>
            </div>
            {error && <p className="text-danger">{error}</p>}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
