import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'River Club — Waitlist',
  description: 'Tee time queue for River Club Glen Arbor',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-rc-navy min-h-screen`}>{children}</body>
    </html>
  )
}
