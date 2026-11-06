# @tenzro/ui

Design system for Tenzro wallet UIs: React components and design tokens, the same ones the reference wallet uses.

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
import { Button, Card, CardContent } from '@tenzro/ui';

export function Approve() {
  return (
    <Card>
      <CardContent>
        <Button>Approve</Button>
      </CardContent>
    </Card>
  );
}
```

## What's inside

- **Primitives** — `Button`, `Card`, `Input`, `AmountInput`, `Badge`, `Dialog`, `Avatar`, `Tabs`, `Separator`, `Progress`, `Switch`, `Tooltip`, `DropdownMenu`, `ScrollArea`.
- **Wallet compositions** — `TxStatus`, `EmptyState`, `Logo`.
- **Tokens** — `@tenzro/ui/tokens` exposes the design tokens as TypeScript constants for Motion configs, charts, and canvas drawing.
- **Utils** — `@tenzro/ui/utils` exposes `cn`, `formatAddress`, `formatAmount`, `formatRelativeTime`.

## License

Apache-2.0
