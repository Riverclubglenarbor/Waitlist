'use client'
import { useState, useRef, useEffect } from 'react'

interface NameStepProps {
  onNext: (firstName: string) => void
}

export default function NameStep({ onNext }: NameStepProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const name = value.trim()
    if (name) onNext(name.charAt(0).toUpperCase() + name.slice(1))
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8">
      <h2 className="text-rc-navy text-3xl font-bold">First Name?</h2>
      <form onSubmit={handleSubmit} className="flex flex-col items-center gap-6 w-full max-w-sm">
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="e.g. Sarah"
          autoCapitalize="words"
          className="w-full text-center text-3xl p-4 rounded-xl border-4 border-rc-green
                     bg-white text-rc-navy outline-none focus:border-green-400"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="bg-rc-green disabled:opacity-40 text-rc-navy px-12 py-4 rounded-xl text-2xl font-bold w-full"
        >
          Next →
        </button>
      </form>
    </div>
  )
}
