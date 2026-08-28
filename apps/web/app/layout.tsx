import type { Metadata, Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import { AuthProvider } from '@/components/AuthProvider';
import { GameProvider } from '@/components/GameProvider';
import './globals.css';

const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-display',
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'Number Rush — real-time 2-player number race',
  description:
    'Send your opponent a number, fill your boxes while they hunt for it, and lock them out the moment you find theirs. First to fill every box wins.'
};

export const viewport: Viewport = {
  themeColor: '#0b0f1a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <body>
        <AuthProvider>
          <GameProvider>{children}</GameProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
