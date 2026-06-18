'use client'
import Image from 'next/image'
import OdometerNumber from './OdometerNumber'

export default function EmptyBoard() {
  return (
    <div className="h-screen bg-rc-navy flex flex-col items-center px-16 py-10" style={{ fontFamily: 'var(--font-montserrat), sans-serif' }}>
      <Image src="/rc-logo.png" alt="River Club Glen Arbor" width={720} height={320} className="object-contain shrink-0" />
      <div className="flex-1 w-full flex flex-col items-center justify-center min-h-0">
        <div className="w-full max-w-3xl bg-rc-green/10 border-2 border-rc-green rounded-3xl py-14 px-10 text-center -translate-y-[10vh]">
          <p className="text-white/60 text-3xl uppercase tracking-widest mb-4">Current Wait</p>
          <div className="flex items-end justify-center gap-4">
            <OdometerNumber value={0} />
            <span className="text-6xl font-normal text-white/70 pb-6">min</span>
          </div>
        </div>
      </div>
      <p className="text-rc-green text-6xl font-bold tracking-wide uppercase shrink-0 whitespace-nowrap mb-4">
        putt · party · eat · repeat
      </p>
    </div>
  )
}
