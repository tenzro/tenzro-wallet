# @tenzro/web

The hosted web wallet — Next.js 16 + React 19 + Tailwind v4. Built for the agentic web with a 2026 deep-dark UI.

## Quick start

```bash
pnpm install
pnpm --filter @tenzro/web dev      # dev server on :3000
pnpm --filter @tenzro/web build    # production build (Turbopack)
pnpm --filter @tenzro/web typecheck
```

## Structure

```
app/
  layout.tsx          # root layout, fonts, providers, toaster
  page.tsx            # marketing landing
  onboarding/         # passkey-quorum setup (5 steps)
  dashboard/          # portfolio + cross-VM legs + agent inbox
  send/               # intent composer + cross-VM route preview
  agents/             # AP2 mandates, ERC-7702 session keys
  activity/           # cross-VM transaction feed
  connect/            # EIP-6963 / CAIP-25 dApp sessions
  canton/             # external DAML party + validator status
  settings/           # quorum, network, agentic defaults
components/
  layout/             # Sidebar, Topbar
  wallet/             # ActivityRow + page-specific compositions
  providers.tsx       # TanStack Query
lib/
  mock-data.ts        # demo data driving the UI
```

The shared design system lives in `packages/ui` (`@tenzro/ui`) — surface badges, agent mandate cards, balance hero, and cross-VM route preview are all imported from there.

## Library versions (verified 2026-05-03)

- next 16.2.4, react 19.2.5, tailwindcss 4.2.4
- motion 12.38.0, @tanstack/react-query 5.100.8
- @radix-ui/react-* (latest), lucide-react 1.14.0
- viem 2.48.8, zod 4.4.2, react-hook-form 7.75.0
