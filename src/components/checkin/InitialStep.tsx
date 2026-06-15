'use client'
import { useRef, useEffect, useState } from 'react'

interface InitialStepProps {
  firstName: string
  onNext: (lastInitial: string) => void
  onBack: () => void
}

export default function InitialStep({ firstName, onNext, onBack }: InitialStepProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')

  useEffect(() => { inputRef.current?.focus() }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const letter = e.target.value.replace(/[^a-zA-Z]/g, '').slice(-1).toUpperCase()
    setValue(letter)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && value) onNext(value)
  }

  function handleSubmit() {
    if (value) onNext(value)
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8">
      <h2 className="text-white text-3xl font-bold">Last Initial, {firstName}?</h2>
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="e.g. D"
        maxLength={1}
        className="w-32 text-center text-5xl p-4 rounded-xl border-4 border-rc-green
                   bg-white text-rc-navy outline-none uppercase"
      />
      <button
        onClick={handleSubmit}
        disabled={!value}
        className="bg-rc-green text-white px-10 py-4 rounded-xl text-xl font-bold
                   disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Next →
      </button>
      <button onClick={onBack} className="text-white/60 text-lg underline">
        ← Back
      </button>
    </div>
  )
}
