/**
 * @tenzro/ui — design system for Tenzro Wallet (web + extension).
 *
 * Three layers:
 *   1. tokens     → CSS variables + TS constants
 *   2. components → low-level primitives (Button, Card, Dialog…)
 *   3. wallet/    → wallet-specific compositions, including the
 *                   chain registry that drives ChainBadge / ChainLogo
 *
 * Consumers import: `import { Button, AssetRow } from '@tenzro/ui';`
 */

export { cn } from './utils/cn';
export {
  formatAddress,
  formatAmount,
  formatRelativeTime,
  formatUsd,
  type SurfaceForAmount,
} from './utils/format';

export {
  surfaceColor,
  surfaceGlow,
  motion as motionTokens,
  type SurfaceKind,
} from './tokens/index';

// Components
export { Button, buttonVariants, type ButtonProps } from './components/button';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/card';
export { Input, AmountInput, type InputProps, type AmountInputProps } from './components/input';
export { Badge, type BadgeProps } from './components/badge';
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from './components/dialog';
export { Avatar } from './components/avatar';
export { Tabs, TabsContent, TabsList, TabsTrigger } from './components/tabs';
export { Separator } from './components/separator';
export { Progress } from './components/progress';
export { Switch } from './components/switch';
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/tooltip';
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/dropdown';
export { ScrollArea } from './components/scroll-area';

// Wallet-specific
export {
  CHAINS,
  ALL_CHAINS,
  chainDecimals,
  classifyRoute,
  type ChainId,
  type ChainMeta,
} from './wallet/chain';
export {
  ChainBadge,
  ChainLogo,
  type ChainBadgeProps,
  type ChainLogoProps,
} from './wallet/chain-badge';
export { SurfaceBadge, type SurfaceBadgeProps } from './wallet/surface-badge';
export { AssetRow, type AssetRowProps } from './wallet/asset-row';
export { CrossVmRoute, type CrossVmRouteProps } from './wallet/cross-vm-route';
export { TxStatus, type TxStatusProps, type TxState } from './wallet/tx-status';
export { IdentityCard, type IdentityCardProps } from './wallet/identity-card';
export {
  AgentMandateCard,
  type AgentMandateCardProps,
  type MandateKind,
} from './wallet/agent-mandate-card';
export { BalanceHero, type BalanceHeroProps, type ChainLeg } from './wallet/balance-hero';
export { EmptyState, type EmptyStateProps } from './wallet/empty-state';
export { Logo, type LogoProps } from './wallet/logo';
export { KeyStat, type KeyStatProps } from './wallet/key-stat';
