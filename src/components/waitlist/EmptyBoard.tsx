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
    <div className="h-screen bg-rc-navy flex flex-col items-center justify-center gap-12 px-16">
      <Image src="/rc-logo.png" alt="River Club Glen Arbor" width={360} height={160} className="object-contain" />
      <div key={msgIndex} className="text-center animate-fade-in">
        <p className="text-white text-6xl font-black leading-tight max-w-3xl text-center">
          {ROTATING_MESSAGES[msgIndex]}
        </p>
      </div>
      <p className="text-rc-green text-3xl font-bold tracking-widest uppercase">
        putt · party · eat · repeat
      </p>
    </div>
  )
}
