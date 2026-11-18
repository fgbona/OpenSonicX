import type { Metadata, Viewport } from 'next';
import './globals.css';
import { I18nProvider } from '@/components/I18n';
import { THEME_BOOT_SCRIPT } from '@/components/ThemeToggle';

export const metadata: Metadata = {
  title: 'Pocket Master Editor',
  description: 'Free browser editor for the Sonicake Pocket Master over USB MIDI.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f2f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
