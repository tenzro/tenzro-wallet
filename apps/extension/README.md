# @tenzro/extension

The official Tenzro Wallet browser extension — WXT + React 19 + MV3.

## Quick start

```bash
pnpm install
pnpm --filter @tenzro/extension dev          # Chrome dev (auto-loads)
pnpm --filter @tenzro/extension dev:firefox  # Firefox dev
pnpm --filter @tenzro/extension build        # production build
pnpm --filter @tenzro/extension zip          # signed zip for store upload
```

## Entrypoints

```
entrypoints/
  background.ts           # MV3 service worker — message router
  content.ts              # bridge between inpage and background
  inpage.ts               # mounts window.tenzro + EIP-6963 announce
  popup/                  # 380×600 toolbar popup
  sidepanel/              # persistent activity feed beside dApp
  options/                # full settings page in own tab
```

## How dApp dispatch works

1. `content.ts` runs at `document_start`, injects `inpage.js` into the page world
2. `inpage.ts` mounts `window.tenzro` (EIP-1193 provider) and dispatches `eip6963:announceProvider`
3. dApps using `tenzro-sdk`'s `discoverEip6963Provider()` find us, call `provider.request({ method, params })`
4. Calls travel `inpage` → `content` → `background` (long-lived port) → kernel dispatch
5. Sensitive methods open the popup for user consent before signing

The kernel ships `buildEip6963Announcement()` to keep the inpage script and the kernel's understanding of provider identity in sync — see `packages/wallet-kernel/src/dapp/`.

## Library versions (verified 2026-05-03)

- wxt 0.20.25, react 19.2.5, tailwindcss 4.2.4
- @wxt-dev/module-react 1.1.4
- motion 12.38.0, lucide-react 1.14.0
