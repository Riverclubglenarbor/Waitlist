'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { EMPTY_BOARD_SLIDES } from '@/lib/empty-board-messages'

export default function EmptyBoard() {
  const [msgIndex, setMsgIndex] = useState(0)
  const [texts, setTexts] = useState<string[]>(EMPTY_BOARD_SLIDES.map(s => s.defaultText))

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(settings => {
        setTexts(EMPTY_BOARD_SLIDES.map(s => settings[s.key] || s.defaultText))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex(i => (i + 1) % EMPTY_BOARD_SLIDES.length)
    }, 8000)
    return () => clearInterval(interval)
  }, [])

  const image = EMPTY_BOARD_SLIDES[msgIndex].image

  return (
    <div className="h-screen bg-rc-navy flex flex-col items-center px-16 py-10">
      <Image src="/rc-logo.png" alt="River Club Glen Arbor" width={720} height={320} className="object-contain shrink-0" />
      <div className="flex-1 w-full flex flex-col items-center justify-center min-h-0 -translate-y-[10vh]">
        <div className="w-full h-[600px] flex items-center justify-center shrink-0 translate-y-[15vh]">
          <p key={msgIndex} className="text-white text-[7.5rem] font-black leading-tight max-w-6xl text-center animate-message-in" style={{ fontFamily: 'var(--font-montserrat), sans-serif' }}>
            {texts[msgIndex]}
          </p>
        </div>
        <div className="w-full h-[544px] pt-6 flex justify-center shrink-0">
          {image && (
            <Image
              key={msgIndex}
              src={image}
              alt="El Gringo Loco"
              width={614}
              height={500}
              priority
              className="object-contain h-[520px] w-auto animate-message-in"
            />
          )}
        </div>
      </div>
      <p className="text-rc-green text-6xl font-bold tracking-wide uppercase shrink-0 whitespace-nowrap mb-4" style={{ fontFamily: 'var(--font-montserrat), sans-serif' }}>
        putt · party · eat · repeat
      </p>
    </div>
  )
}
