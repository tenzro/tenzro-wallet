/**
 * Marketing landing for the hosted wallet — the public entry point.
 *
 * This page exists for the browser-extension install flow ("open in
 * web") and for users who want to try the wallet without installing
 * the extension. Layout choices:
 *   - hero with the four-surface mark and a single CTA → /onboarding
 *   - "what makes Tenzro top-tier" panel — the four execution surfaces,
 *     pointer-ops, passkey-quorum, agentic stack
 *   - 2026 trend signals — agentic mandates, x402, ERC-8004 — to make
 *     it obvious this is a forward-looking wallet
 *
 * Heavy dynamic content uses Motion for arrival animations.
 */

'use client';

import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Cpu,
  Fingerprint,
  Layers,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';

import { Badge, Button, Card, ChainBadge, type ChainId, Logo } from '@tenzro/ui';

const chainHighlights: { chain: ChainId; desc: string }[] = [
  { chain: 'tenzro', desc: 'Sub-second finality. Pointer-op cross-VM via precompile 0x1003.' },
  { chain: 'tenzro-evm', desc: 'Real eth_* — Tenzro-FeeMarket pricing, EIP-1559, EIP-6963.' },
  { chain: 'tenzro-svm', desc: 'Solana program model on the Tenzro synchronizer.' },
  { chain: 'tempo', desc: 'Payments stablechain — AI-agent payments built in.' },
  { chain: 'base', desc: 'EVM L2 — first-class for stablecoin commerce.' },
  { chain: 'ethereum', desc: 'Mainnet via canonical bridge.' },
  { chain: 'solana', desc: 'External SVM via the same SDK as Tenzro SVM.' },
  { chain: 'canton', desc: 'External-party DAML, Splice 0.5 baseline, validator co-signing.' },
];

const trendFacts = [
  {
    icon: Bot,
    title: 'Agentic, end-to-end',
    body: 'Native AP2, ACP, ERC-8004, x402, ERC-7702 session keys — mandates, attestations, and reputation built into the kernel, not bolted on.',
  },
  {
    icon: Fingerprint,
    title: 'Passkey-quorum custody',
    body: 'No seed phrases. FROST Ed25519 + ML-DSA-65 quorum across your devices and a node-TEE co-signer. Post-quantum ready.',
  },
  {
    icon: Zap,
    title: 'Cross-VM is a pointer op',
    body: 'EVM ↔ SVM ↔ native on Tenzro flows through precompile 0x1003. Sub-second, no bridge risk, no LP exposure.',
  },
  {
    icon: ShieldCheck,
    title: 'TDIP, one identity',
    body: 'A single did:tenzro: roots all four surfaces. Surface keys derived deterministically — Ed25519, secp256k1, Canton external party.',
  },
];

export default function LandingPage() {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      {/* ── Top nav ─────────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-6 lg:px-12 py-5">
        <Logo size={32} withWordmark />
        <nav className="hidden md:flex items-center gap-8 text-sm text-foreground-muted">
          <a href="#surfaces" className="hover:text-foreground transition-colors">
            Surfaces
          </a>
          <a href="#agentic" className="hover:text-foreground transition-colors">
            Agentic
          </a>
          <a href="#custody" className="hover:text-foreground transition-colors">
            Custody
          </a>
          <a href="https://docs.tenzro.xyz" className="hover:text-foreground transition-colors">
            Docs
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">Open wallet</Link>
          </Button>
          <Button
            asChild
            variant="primary"
            size="sm"
            rightIcon={<ArrowRight className="size-3.5" />}
          >
            <Link href="/onboarding">Get started</Link>
          </Button>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="relative px-6 lg:px-12 pt-12 pb-24 max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.19, 1, 0.22, 1] }}
          className="relative z-10 max-w-4xl"
        >
          <Badge variant="agent" size="md" className="mb-6">
            <span className="size-1.5 rounded-full bg-current animate-pulse" />
            Built for the agentic web
          </Badge>
          <h1 className="text-5xl sm:text-7xl font-semibold tracking-tighter leading-[0.95] mb-6">
            One identity.
            <br />
            <span className="text-foreground-muted">Every chain.</span>
          </h1>
          <p className="text-xl text-foreground-muted leading-relaxed max-w-2xl">
            The official wallet for the Tenzro Ledger and Network. Native, EVM, SVM, and Canton —
            under one TDIP identity, with passkey-quorum custody and an agentic stack built in.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-10">
            <Button
              asChild
              variant="primary"
              size="xl"
              rightIcon={<ArrowRight className="size-4" />}
            >
              <Link href="/onboarding">Create your wallet</Link>
            </Button>
            <Button asChild variant="secondary" size="xl">
              <Link href="/dashboard">Try the demo</Link>
            </Button>
          </div>

          {/* Chain strip */}
          <div className="flex flex-wrap items-center gap-2 mt-10">
            <span className="text-xs text-foreground-subtle uppercase tracking-widest mr-2">
              Chains
            </span>
            <ChainBadge chain="tenzro" size="md" />
            <ChainBadge chain="tenzro-evm" size="md" />
            <ChainBadge chain="tenzro-svm" size="md" />
            <ChainBadge chain="ethereum" size="md" />
            <ChainBadge chain="base" size="md" />
            <ChainBadge chain="tempo" size="md" />
            <ChainBadge chain="optimism" size="md" />
            <ChainBadge chain="arbitrum" size="md" />
            <ChainBadge chain="polygon" size="md" />
            <ChainBadge chain="bnb" size="md" />
            <ChainBadge chain="solana" size="md" />
            <ChainBadge chain="canton" size="md" />
          </div>
        </motion.div>

        {/* Single soft brand glow — single accent kept restrained */}
        <div className="pointer-events-none absolute right-0 top-0 size-[640px] -translate-y-32 translate-x-32 rounded-full bg-brand/[0.04] blur-3xl" />
      </section>

      {/* ── Chains grid ────────────────────────────────────────────── */}
      <section id="surfaces" className="px-6 lg:px-12 pb-24 max-w-7xl mx-auto">
        <div className="mb-12">
          <Badge variant="default" size="sm" className="mb-3">
            <Layers className="size-3" /> Twelve chains, one wallet
          </Badge>
          <h2 className="text-4xl font-semibold tracking-tight mb-3">
            Tenzro-internal moves are pointer-ops.{' '}
            <span className="text-foreground-muted">
              External chains route through canonical bridges.
            </span>
          </h2>
          <p className="text-lg text-foreground-muted max-w-2xl">
            One TDIP identity, twelve chains. Tenzro-internal value moves through the cross-VM
            precompile — sub-second, no LP. External chains sit behind the canonical bridge router
            with vendor attribution at signing time.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {chainHighlights.map((s, i) => (
            <motion.div
              key={s.chain}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.4, delay: i * 0.04 }}
            >
              <Card variant="raised" className="p-5 h-full">
                <ChainBadge chain={s.chain} size="md" className="mb-3" />
                <p className="text-sm text-foreground-muted leading-relaxed">{s.desc}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Agentic — the differentiator ───────────────────────────── */}
      <section id="agentic" className="px-6 lg:px-12 py-24 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
          <div className="lg:col-span-5">
            <Badge variant="agent" size="md" className="mb-4">
              <Bot className="size-3.5" /> Why Tenzro is top-tier in 2026
            </Badge>
            <h2 className="text-4xl font-semibold tracking-tight mb-4">
              Built for the agentic web from the kernel up.
            </h2>
            <p className="text-lg text-foreground-muted leading-relaxed mb-6">
              Most wallets bolted agent support on with a SDK. Tenzro shipped it as a port: AP2
              mandates, ERC-8004 identity, x402 payments, ERC-7702 session keys, TEE attestation
              receipts — all sit in the kernel next to the surfaces and the router.
            </p>
            <ul className="space-y-3 text-foreground">
              {[
                'Mandate kinds (Intent · Cart · Payment) with first-class consent receipts',
                'ERC-8004 agent reputation surfaced on every request',
                'Policy-constrained spend: cap, window, recipient class, expiry',
                'TEE attestations and verifier identity visible at approval time',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <CheckCircle2 className="size-5 text-agent shrink-0 mt-0.5" />
                  <span className="text-foreground-muted">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {trendFacts.map((t) => {
              const Icon = t.icon;
              return (
                <Card key={t.title} variant="flat" className="p-5">
                  <Icon className="size-6 text-brand mb-3" />
                  <h3 className="font-semibold tracking-tight mb-1.5">{t.title}</h3>
                  <p className="text-sm text-foreground-muted leading-relaxed">{t.body}</p>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Custody ─────────────────────────────────────────────────── */}
      <section id="custody" className="px-6 lg:px-12 py-24 max-w-7xl mx-auto">
        <Card variant="raised" className="p-10 lg:p-16 text-center">
          <Fingerprint className="size-10 text-brand mx-auto mb-6" />
          <h2 className="text-4xl font-semibold tracking-tight mb-4">
            Forget seed phrases.
            <br />
            <span className="text-foreground-muted">Use what you already have.</span>
          </h2>
          <p className="text-lg text-foreground-muted max-w-2xl mx-auto leading-relaxed mb-8">
            Tenzro&apos;s custody model is a passkey-backed FROST Ed25519 quorum across your devices
            and a node-TEE co-signer, with an ML-DSA-65 leg for post-quantum resistance. No words to
            write down. No seed to lose.
          </p>
          <div className="flex justify-center gap-3">
            <Button
              asChild
              variant="primary"
              size="lg"
              rightIcon={<ArrowRight className="size-4" />}
            >
              <Link href="/onboarding">Set up custody</Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <Link href="https://docs.tenzro.xyz/custody">Read the design</Link>
            </Button>
          </div>
        </Card>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="border-t border-border-subtle px-6 lg:px-12 py-8 text-sm text-foreground-muted">
        <div className="flex flex-wrap items-center justify-between gap-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <Logo size={20} />
            <span>© 2026 Tenzro. The official wallet for the Tenzro Ledger.</span>
          </div>
          <div className="flex items-center gap-6">
            <button type="button" className="hover:text-foreground transition-colors">
              Status
            </button>
            <button type="button" className="hover:text-foreground transition-colors">
              Docs
            </button>
            <button type="button" className="hover:text-foreground transition-colors">
              GitHub
            </button>
            <button
              type="button"
              className="hover:text-foreground transition-colors flex items-center gap-1.5"
            >
              <Cpu className="size-3.5" /> rpc.tenzro.xyz
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
