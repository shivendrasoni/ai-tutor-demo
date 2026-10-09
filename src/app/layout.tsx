import type { ReactNode } from 'react';

export const metadata = { title: 'AI Tutor for Schools' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
