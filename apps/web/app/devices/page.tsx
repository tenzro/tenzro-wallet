'use client';

import { Badge, Button, Input } from '@tenzro/ui';
import { useEffect, useState } from 'react';
import { KeystoreClient } from 'tenzro-sdk';

import { ChangePanel } from '@/components/change-panel';
import { CodeBox, Field, Notice, Section, useAction } from '@/components/ui';
import { useWallet } from '@/components/wallet-context';
import { WALLET_NAME, rpId } from '@/lib/config';
import { deviceLabel } from '@/lib/device';
import { decodeInvite, encodeInvite, isWaiting, linkRequest } from '@/lib/keystore';
import { PasskeySigner, createPasskey, keystoreCredential } from '@/lib/passkey';
import type { Passkey } from '@/lib/passkey';
import { remaining } from '@/lib/waits';

export default function Devices() {
  const { wallet } = useWallet();
  const [joining, setJoining] = useState(false);
  useEffect(() => setJoining(window.location.hash === '#join'), []);
  if (!wallet || joining) return <Join />;
  return (
    <>
      <DeviceList />
      <LinkDevice />
      <Policy />
    </>
  );
}

function DeviceList() {
  const { wallet, view, now } = useWallet();
  const [removing, setRemoving] = useState<string | null>(null);
  const credentials = view?.keystore?.credentials ?? [];
  if (!wallet) return null;
  return (
    <Section
      title="Devices"
      description="Every passkey here acts for the account. Each records the domain of the wallet that created it."
    >
      <ul className="divide-y divide-border-subtle">
        {credentials.map((c) => {
          const mine = c.credential_id.replace(/^0x/, '') === wallet.passkey.credentialId;
          const waiting = isWaiting(c, now);
          return (
            <li key={c.credential_id} className="space-y-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{c.label || 'Passkey'}</p>
                  <p className="text-xs text-foreground-muted">
                    {c.rp_id}
                    {c.backup_state ? ' · synced' : ' · this device only'}
                  </p>
                  <div className="flex gap-1.5">
                    {mine ? <Badge>This device</Badge> : null}
                    {waiting ? (
                      <Badge variant="warning">
                        Counts as a root {remaining(c.counts_as_root_from_ms, now)}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                {credentials.length > 1 && !mine ? (
                  <Button
                    size="sm"
                    variant={waiting ? 'danger' : 'ghost'}
                    onClick={() =>
                      setRemoving(removing === c.credential_id ? null : c.credential_id)
                    }
                  >
                    {waiting ? 'Cancel' : 'Remove'}
                  </Button>
                ) : null}
              </div>
              {removing === c.credential_id ? (
                <ChangePanel
                  op={{ remove_credential: { credential_id: c.credential_id } }}
                  label={waiting ? 'Cancel this device' : 'Remove this device'}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {credentials.some((c) => isWaiting(c, now)) ? (
        <Notice tone="warning">
          A device linked while the account had fewer than two independent passkeys waits before it
          counts. If you did not add it, cancel it from any other device.
        </Notice>
      ) : null}
    </Section>
  );
}

function LinkDevice() {
  const { wallet } = useWallet();
  const [invite, setInvite] = useState<string | null>(null);
  if (!wallet) return null;
  return (
    <Section
      title="Link another device"
      description="Use a device of your own, ideally one that does not share this device’s passkey sync account."
    >
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Show the invite below and copy it to the new device.</li>
        <li>
          On the new device, open this wallet, choose “Add this device to my account”, and paste it.
        </li>
        <li>Bring the request code it shows back here, under Requests, and approve it.</li>
      </ol>
      {invite ? (
        <CodeBox code={invite} />
      ) : (
        <Button
          variant="secondary"
          onClick={() =>
            setInvite(encodeInvite({ account: wallet.account, anchor: wallet.anchor }))
          }
        >
          Show invite
        </Button>
      )}
    </Section>
  );
}

function Policy() {
  const { view } = useWallet();
  const [open, setOpen] = useState(false);
  const policy = view?.keystore?.policy ?? 'single_credential';
  const next = policy === 'two_credentials' ? 'single_credential' : 'two_credentials';
  return (
    <Section
      title="Two passkeys for everything"
      description={
        policy === 'two_credentials'
          ? 'On: every change and every payment needs two of your passkeys.'
          : 'Off: any one passkey approves changes. Removing devices, recovery settings and this setting already need two once you have two independent passkeys.'
      }
    >
      {open ? (
        <ChangePanel
          op={{ set_policy: { policy: next } }}
          label={next === 'two_credentials' ? 'Turn on' : 'Turn off'}
        />
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {policy === 'two_credentials' ? 'Turn off' : 'Turn on'}
        </Button>
      )}
    </Section>
  );
}

/** On a new device: join an account with an invite from one of its devices. */
function Join() {
  const { net, setWallet } = useWallet();
  const [inviteText, setInviteText] = useState('');
  const [request, setRequest] = useState<{
    code: string;
    account: string;
    passkey: Passkey;
  } | null>(null);
  const { pending, error, setError, run } = useAction();

  if (request) {
    return (
      <Section
        title="Approve on your other device"
        description="Paste this request code into Requests on a device already on the account. Then come back here."
      >
        <CodeBox code={request.code} />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button
          pending={pending}
          onClick={() =>
            run(async () => {
              if (!net) return;
              const view = await new KeystoreClient(net.rpc).getKeystore(request.account);
              const linked = view.keystore?.credentials.some(
                (c) => c.credential_id.replace(/^0x/, '') === request.passkey.credentialId,
              );
              if (!view.on_chain || !view.keystore || !linked) {
                setError('Not linked yet. Approve the request on your other device first.');
                return;
              }
              setWallet({
                account: request.account,
                did: view.keystore.owner_did,
                passkey: request.passkey,
                anchor: null,
              });
              window.location.hash = '';
              window.location.reload();
            })
          }
        >
          It is approved
        </Button>
      </Section>
    );
  }

  return (
    <Section
      title="Add this device to your account"
      description="This device makes its own passkey. Nothing secret moves between devices."
    >
      <Field label="Invite from your other device">
        <Input
          value={inviteText}
          onChange={(e) => setInviteText(e.target.value)}
          placeholder="tzi1..."
        />
      </Field>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button
        pending={pending}
        disabled={!net || !inviteText.trim()}
        onClick={() =>
          run(async () => {
            if (!net) return;
            const invite = decodeInvite(inviteText);
            const created = await createPasskey({
              rpId: rpId(),
              rpName: WALLET_NAME,
              userName: WALLET_NAME,
              label: deviceLabel(),
            });
            const { registrationAuthenticatorData: _, ...passkey } = created;
            const code = await linkRequest(
              net.rpc,
              invite,
              keystoreCredential(passkey),
              new PasskeySigner(passkey),
            );
            setRequest({ code, account: invite.account, passkey });
          })
        }
      >
        Create a passkey here
      </Button>
    </Section>
  );
}
