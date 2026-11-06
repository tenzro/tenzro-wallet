import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Builds the MV3 extension into extension/dist and packs extension/tenzro-wallet-extension.zip.
// Settings come from the environment at build time; nothing here is secret.
//   EXT_RPC            JSON-RPC of the network (default https://rpc.tenzro.com)
//   EXT_CHAIN_ID       chain id every node must answer for (default 13380)
//   EXT_WALLET_ORIGIN  the wallet the extension hands signing to (default https://wallet.tenzro.com)
//   EXT_RP_ID          WebAuthn RP ID for the experimental in-extension passkey (default: the wallet host)
//   EXT_EXTRA_HOSTS    comma-separated extra host permissions (tests: http://localhost/*)
import { build } from 'esbuild';
import { zipSync } from 'fflate';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = join(here, 'dist');
const rpc = process.env.EXT_RPC ?? 'https://rpc.tenzro.com';
const chainId = Number(process.env.EXT_CHAIN_ID ?? 13380);
const wallet = process.env.EXT_WALLET_ORIGIN ?? 'https://wallet.tenzro.com';
const rpId = process.env.EXT_RP_ID ?? new URL(wallet).hostname;
const extra = (process.env.EXT_EXTRA_HOSTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: {
    popup: join(here, 'src/popup.tsx'),
    background: join(here, 'src/background.ts'),
    bridge: join(here, 'src/bridge.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'esm',
  target: 'chrome122',
  platform: 'browser',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  jsx: 'automatic',
  loader: { '.woff2': 'file' },
  alias: { 'node:crypto': join(here, 'src/node-crypto-shim.js') },
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.NEXT_PUBLIC_WALLET_RP_ID': JSON.stringify(rpId),
    'process.env.NEXT_PUBLIC_WALLET_SEEDS': JSON.stringify(rpc),
    'process.env.NEXT_PUBLIC_WALLET_CHAIN_ID': JSON.stringify(String(chainId)),
    'process.env.NEXT_PUBLIC_WALLET_NAME': JSON.stringify('Tenzro Wallet (extension)'),
    'process.env.NEXT_PUBLIC_WALLET_SECOND_RPC': JSON.stringify(''),
    'process.env.NEXT_PUBLIC_WALLET_SPONSOR_URL': JSON.stringify(''),
    __WALLET_ORIGIN__: JSON.stringify(wallet),
    __RPC__: JSON.stringify(rpc),
    __CHAIN_ID__: String(chainId),
  },
});

cpSync(join(here, 'src/popup.html'), join(dist, 'popup.html'));
cpSync(join(here, 'src/bridge.html'), join(dist, 'bridge.html'));
// One design: the wallet's own stylesheet (the site's tokens), compiled by Tailwind, plus Geist shipped in the package.
const tailwind = await import('node:child_process').then(({ execFileSync }) => {
  const input = join(here, 'dist/_in.css');
  writeFileSync(
    input,
    `@import "${join(here, '../packages/ui/src/tokens/globals.css')}";\n@source "${join(here, 'src')}";\n@source "${join(here, '../apps/web/components')}";\n`,
  );
  const out = execFileSync(join(here, 'node_modules/.bin/tailwindcss'), ['-i', input, '--minify'], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  rmSync(input);
  return out;
});
mkdirSync(join(dist, 'fonts'), { recursive: true });
const geist = join(here, 'node_modules/geist/dist/fonts');
cpSync(join(geist, 'geist-sans/Geist-Variable.woff2'), join(dist, 'fonts/Geist-Variable.woff2'));
cpSync(
  join(geist, 'geist-mono/GeistMono-Variable.woff2'),
  join(dist, 'fonts/GeistMono-Variable.woff2'),
);
writeFileSync(
  join(dist, 'popup.css'),
  `${tailwind}\n${readFileSync(join(here, 'src/popup.css'), 'utf8')}`,
);
cpSync(join(here, 'icons'), dist, { recursive: true });

const hosts = [`${wallet}/*`, `${new URL(rpc).origin}/*`, ...extra];
const manifest = {
  manifest_version: 3,
  name: 'Tenzro Wallet',
  description:
    'The open Tenzro wallet in your toolbar: balance, and passkey approvals through your wallet provider.',
  version: '0.1.0',
  minimum_chrome_version: '122',
  icons: { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 128: 'icon-128.png' },
  action: {
    default_popup: 'popup.html',
    default_title: 'Tenzro Wallet',
    default_icon: { 16: 'icon-16.png', 32: 'icon-32.png' },
  },
  background: { service_worker: 'background.js', type: 'module' },
  permissions: ['storage'],
  host_permissions: [...new Set(hosts)],
  content_security_policy: {
    extension_pages: `script-src 'self'; object-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; connect-src 'self' ${[...new Set([new URL(rpc).origin, ...extra.map((h) => h.replace(/\/\*$/, ''))])].join(' ')}`,
  },
};
writeFileSync(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const files = {};
const walk = (dir, base = '') => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, `${base}${name}/`);
    else files[`${base}${name}`] = new Uint8Array(readFileSync(p));
  }
};
walk(dist);
writeFileSync(
  join(here, 'tenzro-wallet-extension.zip'),
  zipSync(files, { level: 9, mtime: new Date('2026-01-01') }),
);
console.log(
  `built extension/dist and extension/tenzro-wallet-extension.zip (${Object.keys(files).length} files)`,
);
