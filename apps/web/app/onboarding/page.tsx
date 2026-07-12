/**
 * Onboarding — passkey-quorum custody setup.
 *
 * Five-step flow that maps directly to M5 in DESIGN.md:
 *   1. Welcome — explain "no seeds, just passkeys"
 *   2. Provision device #1 — enrol passkey via WebAuthn create()
 *   3. Pair device #2 — QR for cross-device passkey enrolment
 *   4. TDIP DID provision — show the derived did:tenzro: + four
 *      surface keys (Ed25519/secp256k1/Ed25519/Canton-party)
 *   5. Done — drop into the dashboard
 *
 * In production, the WebAuthn create() and HTTP /wallet/new/* calls
 * happen here. We mock them to keep the demo navigable.
 */

'use client';

import {
  ArrowRight,
  Check,
  Fingerprint,
  KeyRound,
  Lock,
  Shield,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import * as React from 'react';

import { Badge, Button, Card, ChainBadge, Logo, Progress, cn } from '@tenzro/ui';

import { shortAddress } from '@/lib/tenzro/format';
import { useFaucet, useWallet } from '@/lib/tenzro/hooks';
import type { StoredWallet } from '@/lib/tenzro/wallet';

const steps = ['Welcome', 'Device 1', 'Pair device 2', 'Identity', 'Done'] as const;
type StepIdx = 0 | 1 | 2 | 3 | 4;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = React.useState<StepIdx>(0);
  const progressPct = ((step + 1) / steps.length) * 100;

  const next = () => setStep((s) => (s < 4 ? ((s + 1) as StepIdx) : s));

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Top bar with logo + progress */}
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
            {step === 0 && <Welcome onContinue={next} />}
            {step === 1 && <ProvisionDevice1 onContinue={next} />}
            {step === 2 && <PairDevice2 onContinue={next} />}
            {step === 3 && <IdentityRecap onContinue={next} />}
            {step === 4 && <Done onContinue={() => router.push('/dashboard')} />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function Welcome({ onContinue }: { onContinue: () => void }) {
  return (
    <Card variant="raised" className="p-10 text-center">
      <div className="inline-flex items-center justify-center size-16 rounded-2xl bg-brand-soft border border-brand/30 mb-6">
        <Fingerprint className="size-8 text-brand" />
      </div>
      <h1 className="text-3xl font-semibold tracking-tight mb-3">No seeds. Just passkeys.</h1>
      <p className="text-foreground-muted leading-relaxed mb-8 max-w-lg mx-auto">
        Tenzro custody is a quorum: your devices hold a FROST-Ed25519 share, our node TEE co-signs
        every operation, and a separate ML-DSA-65 leg keeps you safe in a post-quantum world.
        There&apos;s nothing to write down.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left mb-8">
        {[
          { icon: KeyRound, title: 'No seed phrases', body: 'Use the passkey on your device.' },
          { icon: Shield, title: 'M-of-N quorum', body: 'Two devices today, three by mainnet.' },
          { icon: Lock, title: 'Post-quantum ready', body: 'ML-DSA-65 leg in every signature.' },
        ].map((f) => (
          <div key={f.title} className="rounded-xl bg-surface-1/60 p-4 border border-border-subtle">
            <f.icon className="size-5 text-brand mb-2" />
            <h3 className="text-sm font-semibold mb-1">{f.title}</h3>
            <p className="text-xs text-foreground-muted">{f.body}</p>
          </div>
        ))}
      </div>
      <Button
        onClick={onContinue}
        variant="primary"
        size="lg"
        rightIcon={<ArrowRight className="size-4" />}
      >
        Begin
      </Button>
    </Card>
  );
}

function ProvisionDevice1({ onContinue }: { onContinue: () => void }) {
  const [pending, setPending] = React.useState(false);
  const [success, setSuccess] = React.useState(false);

  const trigger = () => {
    setPending(true);
    // Real impl: navigator.credentials.create({ publicKey: {...} })
    setTimeout(() => {
      setPending(false);
      setSuccess(true);
      setTimeout(onContinue, 800);
    }, 1600);
  };

  return (
    <Card variant="raised" className="p-10">
      <Badge variant="info" size="sm" className="mb-4">
        Step 1 of 3
      </Badge>
      <h2 className="text-2xl font-semibold tracking-tight mb-2">Enrol this device</h2>
      <p className="text-foreground-muted mb-8">
        Your browser will prompt for a passkey. The kernel turns it into a FROST share — the private
        material never leaves your device.
      </p>

      <div className="rounded-2xl bg-surface-1 p-8 border border-border-default mb-6 text-center">
        <motion.div
          initial={{ scale: 1 }}
          animate={pending ? { scale: [1, 1.05, 1] } : { scale: 1 }}
          transition={{ duration: 1.2, repeat: pending ? Number.POSITIVE_INFINITY : 0 }}
          className="inline-flex items-center justify-center size-24 rounded-full bg-brand/10 border-2 border-brand/30 mb-4"
        >
          <Fingerprint
            className={cn(
              'size-12 transition-colors',
              success ? 'text-success' : pending ? 'text-brand' : 'text-foreground-muted',
            )}
          />
        </motion.div>
        <p className="text-sm text-foreground-muted mb-4">
          {success
            ? 'Device enrolled · share #1 sealed'
            : pending
              ? 'Waiting for your passkey…'
              : 'Tap below — your browser will pop the system passkey UI'}
        </p>
        <Button
          onClick={trigger}
          variant="primary"
          size="lg"
          pending={pending}
          success={success}
          width="full"
        >
          {success ? 'Enrolled' : 'Enrol with passkey'}
        </Button>
      </div>
    </Card>
  );
}

function PairDevice2({ onContinue }: { onContinue: () => void }) {
  const pairingUri = 'tenzro://pair?id=mock-1234abcd&v=1';
  return (
    <Card variant="raised" className="p-10">
      <Badge variant="info" size="sm" className="mb-4">
        Step 2 of 3
      </Badge>
      <h2 className="text-2xl font-semibold tracking-tight mb-2">Pair a second device</h2>
      <p className="text-foreground-muted mb-6">
        Open the Tenzro Wallet on your phone and scan the QR. The second share goes there — either
        device can sign, neither can compromise you alone.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
        <div className="flex justify-center">
          <div className="rounded-2xl bg-white p-4">
            <QRCodeSVG
              value={pairingUri}
              size={196}
              bgColor="#ffffff"
              fgColor="#0a0a0c"
              level="M"
            />
          </div>
        </div>
        <div className="space-y-3">
          <Step n={1} title="Open Tenzro on your phone" />
          <Step n={2} title="Tap “Add this device”" />
          <Step n={3} title="Scan the code" />
          <Step n={4} title="Approve with phone passkey" />
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between gap-3">
        <Button variant="ghost" size="md">
          I&apos;ll do this later
        </Button>
        <Button
          onClick={onContinue}
          variant="primary"
          size="md"
          rightIcon={<ArrowRight className="size-4" />}
        >
          Pretend it&apos;s paired
        </Button>
      </div>
    </Card>
  );
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-1 px-3 py-2.5 border border-border-subtle">
      <div className="flex items-center justify-center size-7 rounded-full bg-brand text-brand-foreground text-xs font-semibold tabular">
        {n}
      </div>
      <span className="text-sm">{title}</span>
    </div>
  );
}

function IdentityRecap({ onContinue }: { onContinue: () => void }) {
  const { wallet, loading, error, create } = useWallet();
  const [hasTried, setHasTried] = React.useState(false);

  // First time we land on this step with no wallet, kick onboarding.
  React.useEffect(() => {
    if (!loading && !wallet && !hasTried) {
      setHasTried(true);
      create().catch(() => {
        /* surfaced via `error` */
      });
    }
  }, [loading, wallet, hasTried, create]);

  if (!wallet) {
    return (
      <Card variant="raised" className="p-10">
        <Badge variant="info" size="sm" className="mb-4">
          Step 3 of 3
        </Badge>
        <h2 className="text-2xl font-semibold tracking-tight mb-2">Provisioning your identity</h2>
        <p className="text-foreground-muted mb-6">
          Calling <code className="font-mono text-foreground">tenzro_onboardHuman</code> on{' '}
          <code className="font-mono text-foreground">rpc.tenzro.xyz</code> — this mints your
          DID, your wallet address, and the DPoP-bound access token in one round-trip.
        </p>
        <div className="rounded-2xl bg-surface-1 border border-border-default p-8 text-center">
          {error ? (
            <>
              <p className="text-sm text-danger mb-4">Onboarding failed: {error.message}</p>
              <Button onClick={() => create()} variant="primary" size="md">
                Retry
              </Button>
            </>
          ) : (
            <>
              <div className="inline-block size-6 rounded-full border-2 border-brand border-t-transparent animate-spin mb-4" />
              <p className="text-sm text-foreground-muted">Talking to the testnet…</p>
            </>
          )}
        </div>
      </Card>
    );
  }

  return <IdentityRecapDone wallet={wallet} onContinue={onContinue} />;
}

function IdentityRecapDone({
  wallet,
  onContinue,
}: { wallet: StoredWallet; onContinue: () => void }) {
  return (
    <Card variant="raised" className="p-10">
      <Badge variant="success" size="sm" className="mb-4">
        Step 3 of 3 · Live on testnet
      </Badge>
      <h2 className="text-2xl font-semibold tracking-tight mb-2">Your identity is ready</h2>
      <p className="text-foreground-muted mb-6">
        TDIP rooted your wallet under the DID below. The Tenzro execution surfaces all derive
        deterministically from this root — one identity, every chain.
      </p>

      <div className="rounded-2xl bg-surface-1 border border-border-default p-5 mb-4">
        <span className="text-xs uppercase tracking-widest text-foreground-subtle font-medium">
          DID
        </span>
        <p className="font-mono text-sm text-foreground mt-1.5 break-all">{wallet.did}</p>
      </div>

      <div className="rounded-2xl bg-surface-1 border border-border-default p-5 mb-6">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs uppercase tracking-widest text-foreground-subtle font-medium">
            Tenzro address
          </span>
          <ChainBadge chain="tenzro" size="xs" />
        </div>
        <p className="font-mono text-sm text-foreground break-all">{wallet.address}</p>
        <p className="text-xs text-foreground-subtle mt-1">{shortAddress(wallet.address)}</p>
      </div>

      <Button
        onClick={onContinue}
        variant="primary"
        size="lg"
        width="full"
        rightIcon={<ArrowRight className="size-4" />}
      >
        Continue
      </Button>
    </Card>
  );
}

function Done({ onContinue }: { onContinue: () => void }) {
  const { wallet } = useWallet();
  const faucet = useFaucet(wallet?.address);

  return (
    <Card variant="raised" className="p-10 text-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        className="inline-flex items-center justify-center size-20 rounded-full bg-success/15 border border-success/30 mb-6"
      >
        <Check className="size-10 text-success" />
      </motion.div>
      <h1 className="text-3xl font-semibold tracking-tight mb-3">You&apos;re live on testnet.</h1>
      <p className="text-foreground-muted mb-6 max-w-md mx-auto">
        Your wallet is provisioned on{' '}
        <code className="font-mono text-foreground">rpc.tenzro.xyz</code>. Drip TNZO from the
        faucet to start moving — or hop straight to the dashboard.
      </p>

      {faucet.data && (
        <div
          className={cn(
            'mb-6 mx-auto max-w-md rounded-xl border px-4 py-3 text-sm text-left',
            faucet.data.success
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-warning/30 bg-warning/10 text-warning',
          )}
        >
          {faucet.data.success
            ? `Faucet sent ${faucet.data.amount} · tx ${faucet.data.tx_hash?.slice(0, 18)}…`
            : faucet.data.message}
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
          Drip from faucet
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
