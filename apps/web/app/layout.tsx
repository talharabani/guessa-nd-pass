import type { Metadata, Viewport } from 'next';
import { Baloo_2, Space_Grotesk } from 'next/font/google';
import { AuthProvider } from '@/components/AuthProvider';
import { GameProvider } from '@/components/GameProvider';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';
import './globals.css';
import './themes.css';

const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-display',
  display: 'swap'
});

/*
 * The glyph font for tiles and the target readout.
 *
 * Space Grotesk tops out at 700 and has flat terminals, which reads as a label.
 * The tiles are the toy in this game — they want a rounded face heavy enough to
 * fill the cap, so they get Baloo 2 at 800.
 */
const tileFont = Baloo_2({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-tile',
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'Number Rush — real-time 2-player number race',
  description:
    'Send your opponent a number, fill your boxes while they hunt for it, and lock them out the moment you find theirs. First to fill every box wins.'
};

export const viewport: Viewport = {
  // Overwritten at runtime by applyTheme() so the browser chrome follows the
  // chosen skin; this value is only what an un-themed first paint gets.
  themeColor: '#0b0f1a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${tileFont.variable}`} suppressHydrationWarning>
      <head>
        {/* Sets data-theme before first paint — see THEME_BOOT_SCRIPT. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {/* Drifting background glows — purely decorative, see .aurora. */}
        <div className="aurora" aria-hidden="true">
          <i />
          <i />
        </div>
        <AuthProvider>
          <GameProvider>{children}</GameProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
