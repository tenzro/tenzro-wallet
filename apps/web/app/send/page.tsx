/**
 * Send — one form, smart routing.
 *
 * The user types a recipient address and an amount; the orchestrator
 * (`planSend` + `useSmartSend`) decides the rail:
 *   - Tenzro 32-byte hex   → tenzro_signAndSendTransaction
 *   - Solana base58        → tenzro_bridgeTokens (LayerZero, dest=solana)
 *   - EVM 20-byte 0x       → tenzro_bridgeTokens, user picks the chain
 *                            (address shape alone is ambiguous between
 *                             Ethereum / Base / Polygon / etc.)
 *
 * No tabs, no "wrap first" toggle, no chain pre-picker. The route
 * preview underneath the form explains what will happen so power users
 * can verify the orchestration.
 */

'use client';

import { Send } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { toast } from 'sonner';

import {
  AmountInput,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChainBadge,
  Input,
} from '@tenzro/ui';

import { detectAddress } from '@/lib/tenzro/address';
import { formatTnzo, shortAddress, tnzoToBaseUnits } from '@/lib/tenzro/format';
import { useBalance, useSmartSend, useWallet } from '@/lib/tenzro/hooks';
import { planSend } from '@/lib/tenzro/orchestrate';

export default function SendPage() {
  const { wallet } = useWallet();
  const balance = useBalance(wallet?.address);
  const send = useSmartSend(wallet);

  const [recipient, setRecipient] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [destChain, setDestChain] = React.useState<string | undefined>(undefined);

  const detected = React.useMemo(() => detectAddress(recipient), [recipient]);
  const route = React.useMemo(
    () => planSend({ recipient, forcedDestChain: destChain }),
    [recipient, destChain],
  );

  // Reset chain pick when address kind changes away from EVM.
  React.useEffect(() => {
    if (detected.kind !== 'evm') setDestChain(undefined);
  }, [detected.kind]);

  const liveBalance = balance.data ? formatTnzo(balance.data) : '—';
  const ready =
    !!wallet &&
    !!amount &&
    route.kind !== 'invalid' &&
    (route.kind !== 'bridge' || !!route.selected);

  const submit = React.useCallback(async () => {
    if (!wallet) return;
    try {
      const baseUnits = tnzoToBaseUnits(amount);
      const result = await send.mutateAsync({
        recipient: recipient.trim(),
        amount: baseUnits,
        destChain,
      });
      if (result.route === 'tenzro') {
        toast.success(`Sent · tx ${result.tx_hash.slice(0, 18)}…`);
      } else if (result.status === 'failed') {
        toast.error(`Bridge failed: ${result.error ?? 'unknown error'}`);
      } else {
        toast.success(
          `Bridge ${result.status}${result.tx_hash ? ` · ${result.tx_hash.slice(0, 18)}…` : ''}`,
        );
      }
      setAmount('');
      setRecipient('');
      setDestChain(undefined);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [amount, recipient, destChain, send, wallet]);

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Send TNZO</h1>
        <p className="text-foreground-muted">
          Paste any address. The wallet picks the rail — native Tenzro for Tenzro addresses, a
          bridge for everything else.
        </p>
        {wallet && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-surface-1 border border-border-subtle px-3 py-1.5">
            <ChainBadge chain="tenzro" size="xs" />
            <span className="text-xs text-foreground-muted font-mono">
              {shortAddress(wallet.address)}
            </span>
            <span className="text-xs text-foreground-subtle">·</span>
            <span className="text-xs tabular">{liveBalance} TNZO</span>
          </div>
        )}
      </header>

      <Card variant="raised">
        <CardHeader className="pb-3">
          <CardTitle>Recipient</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="0x… (Tenzro / EVM) or Solana base58"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <RouteHint
            recipient={recipient}
            route={route}
            destChain={destChain}
            onPickChain={setDestChain}
          />
        </CardContent>
      </Card>

      <Card variant="raised">
        <CardHeader className="pb-3">
          <CardTitle>Amount</CardTitle>
        </CardHeader>
        <CardContent>
          <AmountInput
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            symbol="TNZO"
            available={liveBalance}
            onMax={() => balance.data && setAmount(formatTnzo(balance.data, 18))}
          />
        </CardContent>
      </Card>

      <Button
        variant="primary"
        size="lg"
        width="full"
        leftIcon={<Send className="size-4" />}
        disabled={!ready || send.isPending}
        pending={send.isPending}
        onClick={submit}
      >
        {route.kind === 'tenzro'
          ? 'Send on Tenzro testnet'
          : route.kind === 'bridge' && route.selected
            ? `Bridge to ${route.selected.label}`
            : 'Send'}
      </Button>
    </div>
  );
}

interface RouteHintProps {
  readonly recipient: string;
  readonly route: ReturnType<typeof planSend>;
  readonly destChain: string | undefined;
  readonly onPickChain: (id: string) => void;
}

function RouteHint({ recipient, route, destChain, onPickChain }: RouteHintProps) {
  if (!recipient) return null;

  if (route.kind === 'invalid') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
        <Badge variant="warning" size="xs">
          Invalid
        </Badge>
        <span className="text-xs text-foreground-muted">{route.reason}</span>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={route.kind + (route.kind === 'bridge' ? (destChain ?? '') : '')}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className="space-y-2"
      >
        {route.kind === 'tenzro' && (
          <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2">
            <Badge variant="success" size="xs" dot>
              Tenzro testnet
            </Badge>
            <span className="text-xs text-foreground-muted">
              Direct ledger transfer · sub-second finality
            </span>
          </div>
        )}

        {route.kind === 'bridge' && (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-1 px-3 py-2">
              <Badge variant="info" size="xs">
                Bridge
              </Badge>
              <span className="text-xs text-foreground-muted">
                Off-Tenzro destination — LayerZero V2
              </span>
            </div>

            {route.candidates.length > 1 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-widest text-foreground-subtle font-medium">
                  Pick destination chain
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {route.candidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onPickChain(c.id)}
                      className={`text-xs rounded-md px-2 py-1.5 border transition-colors cursor-pointer ${
                        destChain === c.id
                          ? 'border-brand bg-brand-soft text-foreground'
                          : 'border-border-subtle bg-surface-1 hover:border-border-default text-foreground-muted'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-foreground-subtle">
                  EVM addresses are the same shape across chains — we can&apos;t infer this from the
                  address alone.
                </p>
              </div>
            )}

            {route.candidates.length === 1 && route.selected && (
              <p className="text-xs text-foreground-muted px-1">
                → {route.selected.label} (only candidate for this address shape)
              </p>
            )}
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
