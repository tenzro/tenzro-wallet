'use client';

import { Button } from '@tenzro/ui';
import { KeyRound, Laptop, QrCode } from 'lucide-react';

import { type DeviceToLink, useDeviceActions, useWallet } from '@/lib/tenzro/hooks';

/**
 * Adds a passkey on another device to the wallet. From the device that holds
 * the passkey, a phone scans a QR code and makes its own; after signing in with
 * a phone, this device makes one and the phone approves.
 */
export function LinkDeviceActions({
  label,
  onLinked,
}: {
  /** Name recorded for the new device; a default fits each kind. */
  readonly label?: string;
  readonly onLinked?: () => void;
}) {
  const { wallet } = useWallet();
  const { link } = useDeviceActions(wallet);
  const here = !!wallet?.onAnotherDevice;
  const main: DeviceToLink = here ? 'this-device' : 'phone';
  const busy = (via: DeviceToLink) => link.isPending && link.variables?.via === via;
  const run = (via: DeviceToLink, fallback: string) =>
    link.mutate({ label: label?.trim() || fallback, via }, { onSuccess: () => onLinked?.() });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button
          variant="primary"
          size="md"
          leftIcon={here ? <Laptop className="size-4" /> : <QrCode className="size-4" />}
          pending={busy(main)}
          success={link.isSuccess && link.variables?.via === main}
          disabled={!wallet || link.isPending}
          onClick={() => run(main, here ? 'This device' : 'Phone')}
        >
          {here ? 'Add this device' : 'Add a phone'}
        </Button>
        <Button
          variant="secondary"
          size="md"
          leftIcon={<KeyRound className="size-4" />}
          pending={busy('security-key')}
          success={link.isSuccess && link.variables?.via === 'security-key'}
          disabled={!wallet || link.isPending}
          onClick={() => run('security-key', 'Security key')}
        >
          Add a security key
        </Button>
      </div>
      <p className="text-xs text-foreground-subtle">
        {here
          ? 'This device makes its own passkey, then a QR code appears: scan it with your phone to approve.'
          : 'A QR code appears: scan it with your phone, save the passkey there, then approve here.'}
      </p>
      {link.isSuccess && <p className="text-sm text-success">Device added.</p>}
      {link.error && <p className="text-sm text-danger">{link.error.message}</p>}
    </div>
  );
}
