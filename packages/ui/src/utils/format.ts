/**
 * Display formatters for wallet UI.
 *
 * Per the project decimals rule: native + EVM = 18, SVM = 9, Canton CC = 10.
 * `formatAmount` does the per-surface conversion from base-unit BigInt
 * to a human string. Surfaces that need a different precision than the
 * default (e.g. micro-payments stream views) can pass `displayDecimals`.
 */

const DECIMALS_BY_SURFACE = {
  native: 18,
  evm: 18,
  svm: 9,
  canton: 10,
} as const;

export type SurfaceForAmount = keyof typeof DECIMALS_BY_SURFACE;

export function formatAddress(addr: string, head = 6, tail = 4): string {
  if (!addr) return '';
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function formatAmount(
  baseUnits: bigint | string,
  surface: SurfaceForAmount,
  opts: { displayDecimals?: number; trim?: boolean } = {},
): string {
  const decimals = DECIMALS_BY_SURFACE[surface];
  const display = opts.displayDecimals ?? Math.min(decimals, 6);
  const raw = typeof baseUnits === 'bigint' ? baseUnits : BigInt(baseUnits);
  const isNeg = raw < 0n;
  const abs = isNeg ? -raw : raw;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, display);
  const trimmed = opts.trim === false ? fracStr : fracStr.replace(/0+$/, '');
  const wholeStr = whole.toLocaleString('en-US');
  const out = trimmed.length > 0 ? `${wholeStr}.${trimmed}` : wholeStr;
  return isNeg ? `-${out}` : out;
}

export function formatUsd(usd: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact && Math.abs(usd) >= 10_000) {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 2,
      style: 'currency',
      currency: 'USD',
    }).format(usd);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd);
}

export function formatRelativeTime(date: Date | number): string {
  const ms = (typeof date === 'number' ? date : date.getTime()) - Date.now();
  const abs = Math.abs(ms);
  const sec = Math.round(ms / 1000);
  const min = Math.round(ms / 60_000);
  const hr = Math.round(ms / 3_600_000);
  const day = Math.round(ms / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto', style: 'short' });
  if (abs < 60_000) return rtf.format(sec, 'second');
  if (abs < 3_600_000) return rtf.format(min, 'minute');
  if (abs < 86_400_000) return rtf.format(hr, 'hour');
  return rtf.format(day, 'day');
}
