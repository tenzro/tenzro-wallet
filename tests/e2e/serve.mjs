import { readFile, stat } from 'node:fs/promises';
// Serves the static export (apps/web/out) with the headers the README asks a
// host to send. Used by the end-to-end tests and for a local preview.
//   node tests/e2e/serve.mjs [port] [host]
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../apps/web/out/', import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const host = process.argv[3] ?? process.env.HOST ?? '127.0.0.1';
const connect =
  process.env.WALLET_CONNECT_SRC ?? "'self' http://127.0.0.1:* http://localhost:* https:";
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
};
const headers = {
  'content-security-policy': `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src ${connect}; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

async function find(path) {
  const clean = normalize(decodeURIComponent(path.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  for (const c of [clean, `${clean}.html`, join(clean, 'index.html')]) {
    const file = join(root, c);
    if (!file.startsWith(root)) continue;
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {}
  }
  return null;
}

createServer(async (req, res) => {
  const file = await find(req.url ?? '/');
  if (!file) {
    res.writeHead(404, { ...headers, 'content-type': 'text/html' });
    res.end(await readFile(join(root, '404.html')).catch(() => 'not found'));
    return;
  }
  res.writeHead(200, {
    ...headers,
    'content-type': types[extname(file)] ?? 'application/octet-stream',
  });
  res.end(await readFile(file));
}).listen(port, host, () => console.log(`wallet preview on http://${host}:${port}`));
