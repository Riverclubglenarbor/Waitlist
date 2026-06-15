'use client'
import { useRef, useEffect } from 'react'

interface InitialStepProps {
  firstName: string
  onNext: (lastInitial: string) => void
  onBack: () => void
}

export default function InitialStep({ firstName, onNext, onBack }: InitialStepProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const letter = e.target.value.replace(/[^a-zA-Z]/g, '').slice(-1).toUpperCase()
    if (letter) onNext(letter)
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8">
      <h2 className="text-white text-3xl font-bold">Last Initial, {firstName}?</h2>
      <input
        ref={inputRef}
        onChange={handleChange}
        placeholder="e.g. D"
        maxLength={1}
        className="w-32 text-center text-5xl p-4 rounded-xl border-4 border-rc-green
                   bg-white text-rc-navy outline-none uppercase"
      />
      <button onClick={onBack} className="text-white/60 text-lg underline mt-4">
        ← Back
      </button>
    </div>
  )
}
