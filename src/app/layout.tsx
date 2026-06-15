import type { Metadata } from 'next'
import { inter, montserrat } from '@/lib/fonts'
import './globals.css'

export const metadata: Metadata = {
  title: 'River Club — Waitlist',
  description: 'Tee time queue for River Club Glen Arbor',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${montserrat.variable} bg-rc-navy min-h-screen`}>{children}</body>
    </html>
  )
}
