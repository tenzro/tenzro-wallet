# @tenzro/ui

Design system for Tenzro wallet UIs — React components, design tokens, and the chain registry that powers identity-aware wallet surfaces across the four Tenzro VM surfaces (Tenzro native, EVM, SVM, Canton).

## Install

```bash
npm install @tenzro/ui
# peer deps you provide:
npm install react react-dom tailwindcss
```

Requires React 19, Tailwind CSS 4.

## Usage

Import the stylesheet once (it pulls in Tailwind and the design tokens):

```css
/* your app's global stylesheet */
@import "@tenzro/ui/styles.css";
```

Then use components:

```tsx
import { BalanceHero, AssetRow, ChainBadge } from '@tenzro/ui';

export function Wallet() {
  return (
    <BalanceHero
      totalUsd={12450.32}
      changePct={2.1}
      legs={[
        { chain: 'tenzro', baseUnits: 4200000000000000000000n, usdValue: 4200 },
        { chain: 'base', baseUnits: 1500000000000000000n, usdValue: 3100 },
      ]}
    />
  );
}
```

## What's inside

- **Primitives** — `Button`, `Card`, `Input`, `AmountInput`, `Badge`, `Dialog`, `Avatar`, `Tabs`, `Separator`, `Progress`, `Switch`, `Tooltip`, `DropdownMenu`, `ScrollArea`.
- **Wallet compositions** — `BalanceHero`, `AssetRow`, `ChainBadge`, `ChainLogo`, `CrossVmRoute`, `TxStatus`, `IdentityCard`, `AgentMandateCard`, `EmptyState`, `KeyStat`, `Logo`.
- **Chain registry** — `CHAINS`, `ALL_CHAINS`, `chainDecimals`, `classifyRoute`, plus the `ChainId` / `ChainMeta` types. The canonical UI taxonomy mapping each chain to its dispatch surface.
- **Tokens** — `@tenzro/ui/tokens` exposes the design tokens as TypeScript constants for Motion configs, charts, and canvas drawing.
- **Utils** — `@tenzro/ui/utils` exposes `cn`, `formatAddress`, `formatAmount`, `formatUsd`, `formatRelativeTime`.

## License

Apache-2.0
