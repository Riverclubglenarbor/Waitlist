'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'

const ROTATING_MESSAGES: { text: string; image?: string }[] = [
  { text: "No wait — it's your time to shine! ⛳" },
  { text: "Step right up! The course is all yours." },
  { text: "Walk right on — no waiting today!" },
  { text: "The course is calling your name." },
  { text: "Before you go, you need a Gringo Loco...", image: "/el-gringo-loco.png" },
]

export default function EmptyBoard() {
  const [msgIndex, setMsgIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex(i => (i + 1) % ROTATING_MESSAGES.length)
    }, 8000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="h-screen bg-rc-navy flex flex-col items-center px-16 py-10">
      <Image src="/rc-logo.png" alt="River Club Glen Arbor" width={720} height={320} className="object-contain shrink-0" />
      <div className="flex-1 w-full flex flex-col items-center justify-center min-h-0 -translate-y-[15vh]">
        <p key={msgIndex} className="text-white text-[7.5rem] font-black leading-tight max-w-6xl text-center animate-message-in" style={{ fontFamily: 'var(--font-montserrat), sans-serif' }}>
          {ROTATING_MESSAGES[msgIndex].text}
        </p>
        <div className="w-full h-[544px] pt-6 flex justify-center shrink-0">
          {ROTATING_MESSAGES[msgIndex].image && (
            <Image
              key={msgIndex}
              src={ROTATING_MESSAGES[msgIndex].image!}
              alt="El Gringo Loco"
              width={614}
              height={500}
              priority
              className="object-contain h-[520px] w-auto animate-message-in"
            />
          )}
        </div>
      </div>
      <p className="text-rc-green text-6xl font-bold tracking-wide uppercase shrink-0 whitespace-nowrap mb-4">
        putt · party · eat · repeat
      </p>
    </div>
  )
}
