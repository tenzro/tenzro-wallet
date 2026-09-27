/**
 * Runtime theming. The wallet's styles derive from a small set of `--tz-*`
 * CSS variables; `applyTheme` sets them on an element, so an app embedding the
 * wallet can match its own look without writing CSS. Anything left out keeps
 * the tenzro.com default for the current light / dark mode.
 */

export interface TenzroTheme {
  readonly background: string;
  readonly foreground: string;
  readonly muted: string;
  readonly mutedForeground: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly surface: string;
  readonly accent: string;
  readonly accentHover: string;
  readonly accentSoft: string;
  readonly accentForeground: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  /** Base corner radius; the scale is derived from it (e.g. "0.5rem", "0"). */
  readonly radius: string;
  readonly fontSans: string;
  readonly fontMono: string;
}

export type ThemeMode = 'light' | 'dark' | 'system';

const VARIABLE: Record<keyof TenzroTheme, string> = {
  background: '--tz-background',
  foreground: '--tz-foreground',
  muted: '--tz-muted',
  mutedForeground: '--tz-muted-foreground',
  border: '--tz-border',
  borderStrong: '--tz-border-strong',
  surface: '--tz-surface',
  accent: '--tz-accent',
  accentHover: '--tz-accent-hover',
  accentSoft: '--tz-accent-soft',
  accentForeground: '--tz-accent-foreground',
  success: '--tz-success',
  warning: '--tz-warning',
  danger: '--tz-danger',
  radius: '--tz-radius',
  fontSans: '--tz-font-sans',
  fontMono: '--tz-font-mono',
};

/** tenzro.com's palette, light and dark. */
export const tenzroTheme: { readonly light: TenzroTheme; readonly dark: TenzroTheme } = {
  light: {
    background: '#ffffff',
    foreground: '#0a0a0a',
    muted: '#5f6672',
    mutedForeground: '#4b5563',
    border: '#e5e7eb',
    borderStrong: '#d4d4d8',
    surface: '#fafafa',
    accent: '#3d4a6b',
    accentHover: '#2c3654',
    accentSoft: '#eef1f8',
    accentForeground: '#ffffff',
    success: 'oklch(0.52 0.11 150)',
    warning: 'oklch(0.6 0.12 70)',
    danger: 'oklch(0.55 0.17 25)',
    radius: '0.5rem',
    fontSans: '"Geist", "Inter", ui-sans-serif, system-ui, sans-serif',
    fontMono: '"Geist Mono", "JetBrains Mono", ui-monospace, monospace',
  },
  dark: {
    background: '#000000',
    foreground: '#ffffff',
    muted: '#8e8e98',
    mutedForeground: '#a1a1aa',
    border: '#232327',
    borderStrong: '#34343a',
    surface: '#0b0b0d',
    accent: '#8a9bc7',
    accentHover: '#a8b6d6',
    accentSoft: '#11151f',
    accentForeground: '#0a0a0a',
    success: 'oklch(0.74 0.09 145)',
    warning: 'oklch(0.78 0.09 75)',
    danger: 'oklch(0.66 0.13 25)',
    radius: '0.5rem',
    fontSans: '"Geist", "Inter", ui-sans-serif, system-ui, sans-serif',
    fontMono: '"Geist Mono", "JetBrains Mono", ui-monospace, monospace',
  },
};

/**
 * Override theme values on `target` (default: the document root). Pass
 * `mode` to pin light or dark; `system` follows the OS.
 */
export function applyTheme(
  overrides: Partial<TenzroTheme>,
  opts: { readonly mode?: ThemeMode; readonly target?: HTMLElement } = {},
): void {
  if (typeof document === 'undefined') return;
  const el = opts.target ?? document.documentElement;
  for (const [key, value] of Object.entries(overrides) as [keyof TenzroTheme, string | undefined][]) {
    if (value !== undefined) el.style.setProperty(VARIABLE[key], value);
  }
  if (opts.mode === 'light' || opts.mode === 'dark') el.setAttribute('data-theme', opts.mode);
  else if (opts.mode === 'system') el.removeAttribute('data-theme');
}

/** Remove every override `applyTheme` set on `target`. */
export function resetTheme(target?: HTMLElement): void {
  if (typeof document === 'undefined') return;
  const el = target ?? document.documentElement;
  for (const name of Object.values(VARIABLE)) el.style.removeProperty(name);
}
