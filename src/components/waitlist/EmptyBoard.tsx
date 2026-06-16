'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'

const ROTATING_MESSAGES = [
  "No wait — it's your time to shine! ⛳",
  "Step right up! The course is all yours.",
  "Walk right on — no waiting today!",
  "The course is calling your name.",
]

export default function EmptyBoard() {
  const [msgIndex, setMsgIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex(i => (i + 1) % ROTATING_MESSAGES.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="h-screen bg-rc-navy flex flex-col items-center px-16 py-10">
      <Image src="/rc-logo.png" alt="River Club Glen Arbor" width={720} height={320} className="object-contain shrink-0" />
      <div className="flex-1 w-full flex items-center justify-center min-h-0">
        <div key={msgIndex} className="text-center animate-fade-in">
          <p className="text-white text-[7.5rem] font-black leading-tight max-w-6xl text-center" style={{ fontFamily: 'var(--font-montserrat), sans-serif' }}>
            {ROTATING_MESSAGES[msgIndex]}
          </p>
        </div>
      </div>
      <p className="text-rc-green text-6xl font-bold tracking-widest uppercase shrink-0">
        putt · party · eat · repeat
      </p>
    </div>
  )
}
