/**
 * Root layout — fonts, providers, toaster, and the dark color-scheme
 * baked into the <html> attribute so the browser paints the chrome
 * (scrollbars, form controls) dark before our CSS lands.
 */

import { TooltipProvider } from '@tenzro/ui';
import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from 'sonner';

import { Providers } from '@/components/providers';
import { ServiceWorker } from '@/components/service-worker';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'Tenzro Wallet — One identity, every surface',
    template: '%s · Tenzro Wallet',
  },
  description:
    'The official wallet for the Tenzro Ledger and Network. Native, EVM, SVM, and Canton — under one TDIP identity, secured by your passkeys, with an agentic stack built in.',
  applicationName: 'Tenzro Wallet',
  authors: [{ name: 'Tenzro' }],
  metadataBase: new URL('https://wallet.tenzro.com'),
  openGraph: {
    title: 'Tenzro Wallet',
    description: 'One wallet. Four surfaces. No seed phrases. Built for the agentic web.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>
          <TooltipProvider delayDuration={150}>
            {children}
            <Toaster
              position="bottom-right"
              theme="dark"
              toastOptions={{
                style: {
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border-default)',
                  color: 'var(--color-foreground)',
                },
              }}
            />
          </TooltipProvider>
        </Providers>
        <ServiceWorker />
      </body>
    </html>
  );
}
