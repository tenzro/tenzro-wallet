'use client';

/**
 * One passkey of the wallet, as the network's keystore holds it: its name,
 * the wallet provider it is registered with, when it joined, and where it
 * stands in plain words. Every field has something to say; nothing is left
 * blank.
 */

import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from '@tenzro/ui';
import { Smartphone } from 'lucide-react';
import type { DeviceSummary } from 'tenzro-wallet/custody';

import { TENZRO_RP_ID } from '@/lib/tenzro/config';
import { rpcCall } from '@/lib/tenzro/rpc';

/** "Chrome on macOS" for this browser, from what it reports about itself. */
export function browserOnOs(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'this browser';
  const os = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return os ? `${browser} on ${os}` : browser;
}

/** The name a row shows: the holder's label, else a clear default. */
export function deviceName(d: DeviceSummary, userAgent: string): string {
  if (d.label) return d.label;
  if (d.thisDevice) return `Passkey on ${browserOnOs(userAgent)}`;
  const provider = d.rpId && d.rpId !== TENZRO_RP_ID ? ` from ${d.rpId}` : '';
  return `Passkey ${d.credentialIdHex.replace(/^0x/, '').slice(0, 6)}${provider}`;
}

const when = (ms: number) => new Date(ms).toLocaleString();

/** Where the passkey stands, in plain words. */
export function deviceState(d: DeviceSummary): {
  readonly text: string;
  readonly tone: 'success' | 'warning' | 'default';
} {
  switch (d.status ?? 'on-wallet') {
    case 'waiting':
      return {
        text: `Linked; counts as a device from ${d.countsFromMs ? when(d.countsFromMs) : 'the end of its wait'}`,
        tone: 'warning',
      };
    case 'recovering':
      return {
        text: `Joining by recovery; completes ${d.countsFromMs ? when(d.countsFromMs) : 'after its wait'}. Any device on the wallet can cancel it.`,
        tone: 'warning',
      };
    default:
      return { text: 'On the wallet', tone: 'success' };
  }
}

/** When it joined, in plain words. */
export function deviceAdded(d: DeviceSummary): string {
  if (d.status === 'recovering') return 'Not on the wallet yet';
  return d.addedAtMs ? `Added ${when(d.addedAtMs)}` : 'Added when the wallet was created';
}

function useStakedProvider(rpId: string | undefined) {
  return useQuery({
    queryKey: ['tenzro', 'walletProvider', rpId],
    enabled: !!rpId && rpId !== TENZRO_RP_ID,
    queryFn: () => rpcCall<{ staked: boolean }>('tenzro_getWalletProvider', { rp_id: rpId }),
    staleTime: 600_000,
  });
}

export function DeviceRow({
  device: d,
  onlyDevice,
  removing,
  onRemove,
  userAgent,
}: {
  readonly device: DeviceSummary;
  readonly onlyDevice: boolean;
  readonly removing: boolean;
  readonly onRemove: () => void;
  readonly userAgent: string;
}) {
  const state = deviceState(d);
  const foreign = !!d.rpId && d.rpId !== TENZRO_RP_ID;
  const provider = useStakedProvider(d.rpId);
  const removable = !onlyDevice && !d.thisDevice && d.status !== 'recovering';
  return (
    <div
      data-device={d.credentialIdHex}
      data-state={d.status ?? 'on-wallet'}
      className="flex items-start gap-3 rounded-xl bg-surface-2 border border-border-subtle p-3"
    >
      <Smartphone className="size-5 text-foreground-muted mt-0.5" />
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">{deviceName(d, userAgent)}</span>
          {d.thisDevice && (
            <Badge variant="agent" size="xs">
              This device
            </Badge>
          )}
          <Badge variant={state.tone} size="xs" dot>
            {d.status === 'waiting'
              ? 'Waiting'
              : d.status === 'recovering'
                ? 'Recovering'
                : 'On the wallet'}
          </Badge>
        </div>
        {d.status && d.status !== 'on-wallet' && (
          <span className="block text-xs text-foreground-muted">{state.text}</span>
        )}
        {foreign && (
          <span className="block text-xs text-foreground-muted">
            From the wallet provider {d.rpId}
            {provider.data?.staked ? ' · staked provider' : ''}
          </span>
        )}
        <span className="block text-xs text-foreground-subtle">
          {deviceAdded(d)} ·{' '}
          {d.thisDevice ? 'In use now' : 'Last use is not recorded on the network'}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={!removable || removing}
        title={
          onlyDevice
            ? 'The only device cannot be removed'
            : d.thisDevice
              ? 'Remove this device from another one'
              : d.status === 'recovering'
                ? 'Cancel the recovery instead'
                : undefined
        }
        onClick={onRemove}
      >
        Remove
      </Button>
    </div>
  );
}
