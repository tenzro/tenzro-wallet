import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Renders the site's mark (ring and dot, tenzro.com/brand/tenzro-logo.svg) to the toolbar sizes.
//   CHROMIUM=/path/to/chrome node scripts/icons.mjs
import { chromium } from '@playwright/test';

const out = fileURLToPath(new URL('../icons/', import.meta.url));
const svg = (s) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 20 20"><rect width="20" height="20" rx="4" fill="#ffffff"/><circle cx="10" cy="10" r="6.4" stroke="#0a0a0a" stroke-width="${s < 32 ? 1.6 : 1.2}" fill="none"/><circle cx="10" cy="10" r="2.6" fill="#0a0a0a"/></svg>`;
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const page = await browser.newPage();
for (const s of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<body style="margin:0;background:transparent">${svg(s)}</body>`);
  writeFileSync(
    `${out}icon-${s}.png`,
    await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } }),
  );
}
await browser.close();
