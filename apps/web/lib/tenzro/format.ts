/**
 * TNZO has 18 decimals (matching the testnet's wei-style hex returns
 * from `tenzro_getBalance`). These helpers do the hex↔decimal
 * conversion without dragging in a BigNumber library — `BigInt` is
 * exact for any integer base-unit count.
 */

const TNZO_DECIMALS = 18;

export function hexToBigInt(hex: string): bigint {
  if (!hex || hex === '0x') return 0n;
  return BigInt(hex);
}

export function formatTnzo(hex: string, displayDecimals = 4): string {
  const wei = hexToBigInt(hex);
  const divisor = 10n ** BigInt(TNZO_DECIMALS);
  const whole = wei / divisor;
  const frac = wei % divisor;
  if (displayDecimals === 0 || frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(TNZO_DECIMALS, '0').slice(0, displayDecimals);
  const trimmed = fracStr.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

/**
 * Format a base-unit balance (decimal string, not hex) at the given
 * decimal precision. `tenzro_getTokenBalance` returns plain decimal
 * strings per VM projection, so we can't reuse `formatTnzo` (which
 * parses hex from `tenzro_getBalance`).
 */
export function formatBaseUnits(baseUnits: string, decimals: number, displayDecimals = 4): string {
  const wei = baseUnits ? BigInt(baseUnits) : 0n;
  const divisor = 10n ** BigInt(decimals);
  const whole = wei / divisor;
  const frac = wei % divisor;
  if (displayDecimals === 0 || frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, displayDecimals);
  const trimmed = fracStr.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

export function tnzoToBaseUnits(decimal: string): string {
  const trimmed = decimal.trim();
  if (!trimmed) return '0';
  const [whole = '0', frac = ''] = trimmed.split('.');
  const fracPadded = frac.padEnd(TNZO_DECIMALS, '0').slice(0, TNZO_DECIMALS);
  const big = BigInt(whole) * 10n ** BigInt(TNZO_DECIMALS) + BigInt(fracPadded || '0');
  return big.toString();
}

export function shortAddress(address: string, head = 6, tail = 4): string {
  if (!address) return '';
  if (address.length <= head + tail + 3) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function shortDid(did: string, tail = 6): string {
  if (!did) return '';
  const parts = did.split(':');
  const last = parts[parts.length - 1] ?? did;
  if (last.length <= tail + 3) return did;
  return `${parts.slice(0, -1).join(':')}:…${last.slice(-tail)}`;
}
