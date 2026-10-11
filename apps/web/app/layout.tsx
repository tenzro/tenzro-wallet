import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { ServiceWorker } from '@/components/service-worker';
import { Shell } from '@/components/shell';
import { WalletProvider } from '@/components/wallet-context';
import { WALLET_NAME } from '@/lib/config';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: WALLET_NAME, template: `%s · ${WALLET_NAME}` },
  description:
    'A passkey wallet with no seed phrase. Your devices, guardians and recovery live in your account on the network.',
  applicationName: WALLET_NAME,
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
        <WalletProvider>
          <Shell>{children}</Shell>
        </WalletProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
