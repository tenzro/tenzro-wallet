/**
 * Onboarding — a non-custodial wallet from a passkey.
 *
 *   1. Welcome — create a wallet with a passkey, or sign in with one
 *   2. Second device — link a phone, laptop or security key (strongly
 *      recommended: one passkey is one lost device away from losing the wallet)
 *   3. Done — identity, account, faucet
 *
 * Every step talks to the node directly (`tenzro_enrollPasskey`,
 * `tenzro_addPasskey`, `tenzro_faucet`); nothing secret is stored.
 */

'use client';

import { ArrowRight, Check, Fingerprint, KeyRound, Lock, Smartphone, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Badge, Button, Card, ChainBadge, Input, Logo, Progress, cn } from '@tenzro/ui';

import { LinkDeviceActions } from '@/components/wallet/link-device';
import { shortAddress } from '@/lib/tenzro/format';
import { useFaucet, usePlatformPasskey, useWallet } from '@/lib/tenzro/hooks';

const steps = ['Passkey', 'Second device', 'Done'] as const;
type StepIdx = 0 | 1 | 2;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = React.useState<StepIdx>(0);
  const progressPct = ((step + 1) / steps.length) * 100;

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="flex items-center justify-between px-6 lg:px-12 py-5 border-b border-border-subtle">
        <Link href="/">
          <Logo size={28} withWordmark />
        </Link>
        <div className="hidden sm:flex items-center gap-3 flex-1 max-w-md mx-8">
          <Progress value={progressPct} variant="brand" />
          <span className="tabular text-xs text-foreground-muted whitespace-nowrap">
            Step {step + 1} of {steps.length}
          </span>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">Cancel</Link>
        </Button>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3, ease: [0.19, 1, 0.22, 1] }}
            className="w-full max-w-2xl"
          >
            {step === 0 && <CreateOrSignIn onDone={() => setStep(1)} />}
            {step === 1 && <SecondDevice onContinue={() => setStep(2)} />}
            {step === 2 && <Done onContinue={() => router.push('/dashboard')} />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function CreateOrSignIn({ onDone }: { onDone: () => void }) {
  const { create, signIn, loading, error } = useWallet();
  const platform = usePlatformPasskey();
  const [name, setName] = React.useState('');
  const [pending, setPending] = React.useState<'create' | 'sign-in' | null>(null);
  const [phoneChosen, setPhoneChosen] = React.useState(false);
  // Without a passkey on this device, the browser's QR code brings in a phone.
  const phone = phoneChosen || platform === false;
  const entry = phone ? { hints: ['hybrid'] as const } : {};

  const run = async (kind: 'create' | 'sign-in') => {
    setPending(kind);
    try {
      if (kind === 'create') await create(name.trim() || 'Tenzro wallet', entry);
      else await signIn(entry);
      onDone();
    } catch {
      // surfaced via `error`
    } finally {
      setPending(null);
    }
  };

  return (
    <Card variant="raised" className="p-10">
      <div className="text-center">
        <div className="inline-flex items-center justify-center size-16 rounded-2xl bg-brand-soft border border-brand/30 mb-6">
          <Fingerprint className="size-8 text-brand" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-3">Your wallet is a passkey.</h1>
        <p className="text-foreground-muted leading-relaxed mb-8 max-w-lg mx-auto">
          Your identity and account are created from a passkey on this device. Every approval is
          signed on the device, twice: with the passkey and with a post-quantum ML-DSA-65 key
          derived from it. Nothing is stored and there is nothing to write down.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left mb-8">
        {[
          { icon: KeyRound, title: 'Non-custodial', body: 'Keys stay in your devices.' },
          { icon: Smartphone, title: 'Link devices', body: 'Any enrolled device can approve.' },
          { icon: Lock, title: 'Quantum-safe', body: 'Every approval carries ML-DSA-65.' },
        ].map((f) => (
          <div key={f.title} className="rounded-xl bg-surface-1/60 p-4 border border-border-subtle">
            <f.icon className="size-5 text-brand mb-2" />
            <h3 className="text-sm font-semibold mb-1">{f.title}</h3>
            <p className="text-xs text-foreground-muted">{f.body}</p>
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <Input
          placeholder="Your name (shown on your passkey)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="username webauthn"
        />
        <Button
          onClick={() => run('create')}
          variant="primary"
          size="lg"
          width="full"
          pending={pending === 'create'}
          disabled={loading && pending !== 'create'}
          rightIcon={<ArrowRight className="size-4" />}
        >
          Create wallet with a passkey
        </Button>
        <Button
          onClick={() => run('sign-in')}
          variant="secondary"
          size="lg"
          width="full"
          pending={pending === 'sign-in'}
        >
          I already have a Tenzro passkey
        </Button>
        {phone ? (
          <p className="text-sm text-foreground-muted">
            {platform === false ? 'This device cannot hold a passkey. ' : ''}A QR code will appear:
            scan it with your phone and approve there.
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
        {error && <p className="text-sm text-danger">{error.message}</p>}
      </div>
    </Card>
  );
}

function SecondDevice({ onContinue }: { onContinue: () => void }) {
  const [label, setLabel] = React.useState('');
  const [done, setDone] = React.useState(false);

  return (
    <Card variant="raised" className="p-10">
      <Badge variant="warning" size="sm" className="mb-4">
        Strongly recommended
      </Badge>
      <h2 className="text-2xl font-semibold tracking-tight mb-2">Add a second device</h2>
      <p className="text-foreground-muted mb-6">
        A passkey that stays on one device cannot be copied, which is what makes it safe, and also
        why losing that device would lose the wallet. Add your phone or a security key: any linked
        device can open and approve for this wallet. Until then this wallet can receive but not
        send. Synced passkeys count as a lower tier and are never the only protection.
      </p>
      <div className="space-y-3">
        <Input
          placeholder="Device name, e.g. Phone"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <LinkDeviceActions label={label} onLinked={() => setDone(true)} />
      </div>
      <div className="mt-8 flex items-center justify-between gap-3">
        <Button variant="ghost" size="md" onClick={onContinue}>
          {done ? 'Continue' : 'Later'}
        </Button>
        {done && (
          <Button
            onClick={onContinue}
            variant="primary"
            size="md"
            rightIcon={<ArrowRight className="size-4" />}
          >
            Continue
          </Button>
        )}
      </div>
    </Card>
  );
}

function Done({ onContinue }: { onContinue: () => void }) {
  const { wallet } = useWallet();
  const faucet = useFaucet(wallet?.account);

  return (
    <Card variant="raised" className="p-10">
      <div className="text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          className="inline-flex items-center justify-center size-20 rounded-full bg-success/15 border border-success/30 mb-6"
        >
          <Check className="size-10 text-success" />
        </motion.div>
        <h1 className="text-3xl font-semibold tracking-tight mb-3">
          You&apos;re on Tenzro Network 1.
        </h1>
      </div>

      {wallet && (
        <div className="space-y-3 mb-6">
          <div className="rounded-2xl bg-surface-1 border border-border-default p-5">
            <span className="text-xs uppercase tracking-widest text-foreground-subtle font-medium">
              Identity
            </span>
            <p className="font-mono text-sm text-foreground mt-1.5 break-all">{wallet.did}</p>
          </div>
          <div className="rounded-2xl bg-surface-1 border border-border-default p-5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs uppercase tracking-widest text-foreground-subtle font-medium">
                Account
              </span>
              <ChainBadge chain="tenzro" size="xs" />
            </div>
            <p className="font-mono text-sm text-foreground break-all">{wallet.account}</p>
            <p className="text-xs text-foreground-subtle mt-1">{shortAddress(wallet.account)}</p>
          </div>
        </div>
      )}

      {faucet.data && (
        <div
          className={cn(
            'mb-6 rounded-xl border px-4 py-3 text-sm',
            faucet.data.success
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-warning/30 bg-warning/10 text-warning',
          )}
        >
          {faucet.data.message}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Button
          onClick={() => faucet.mutate()}
          variant="secondary"
          size="lg"
          pending={faucet.isPending}
          disabled={!wallet}
        >
          Get TNZO from the faucet
        </Button>
        <Button
          onClick={onContinue}
          variant="primary"
          size="lg"
          rightIcon={<Sparkles className="size-4" />}
        >
          Open dashboard
        </Button>
      </div>
    </Card>
  );
}
