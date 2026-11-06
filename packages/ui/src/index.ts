/**
 * @tenzro/ui — design system for Tenzro wallet UIs.
 *
 * Three layers:
 *   1. tokens     → CSS variables + TS constants
 *   2. components → low-level primitives (Button, Card, Dialog…)
 *   3. wallet/    → small wallet compositions (logo, empty state, status)
 *
 * Consumers import: `import { Button, Card } from '@tenzro/ui';`
 * and the stylesheet once: `@import "@tenzro/ui/styles.css";`
 */

export { cn } from './utils/cn';
export {
  formatAddress,
  formatAmount,
  formatRelativeTime,
} from './utils/format';

export {
  motion as motionTokens,
  applyTheme,
  resetTheme,
  tenzroTheme,
  type TenzroTheme,
  type ThemeMode,
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

// Wallet compositions
export { TxStatus, type TxStatusProps, type TxState } from './wallet/tx-status';
export { EmptyState, type EmptyStateProps } from './wallet/empty-state';
export { Logo, type LogoProps } from './wallet/logo';
