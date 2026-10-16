import type { ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import DemoShell from '@/demo/core/DemoShell';
import './globals.css';

const font = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-geist-sans', display: 'swap' });

export const metadata = { title: 'AI Tutor for Schools' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={font.variable}>
      <body className="min-h-svh font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider><DemoShell>{children}</DemoShell></TooltipProvider>
          <Toaster richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
