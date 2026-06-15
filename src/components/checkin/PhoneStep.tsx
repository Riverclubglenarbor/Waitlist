'use client'
import { useState, useRef, useEffect } from 'react'

interface PhoneStepProps {
  onSubmit: (phone: string) => void
  onBack: () => void
  loading: boolean
}

export default function PhoneStep({ onSubmit, onBack, loading }: PhoneStepProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function toE164(raw: string): string {
    const digits = raw.replace(/\D/g, '')
    return digits.length === 10 ? `+1${digits}` : `+${digits}`
  }

  function isValid(raw: string): boolean {
    return raw.replace(/\D/g, '').length >= 10
  }

  function submit() {
    if (!isValid(value)) {
      setError('Please enter a valid 10-digit phone number')
      return
    }
    setError('')
    onSubmit(toE164(value))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    submit()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') submit()
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8">
      <h2 className="text-rc-navy text-3xl font-bold">Phone Number for Texts?</h2>
      <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4 w-full max-w-sm">
        <input
          ref={inputRef}
          type="tel"
          value={value}
          onChange={e => { setValue(e.target.value); setError('') }}
          onKeyDown={handleKeyDown}
          placeholder="(231) 555-0100"
          className="w-full text-center text-3xl p-4 rounded-xl border-4 border-rc-green
                     bg-white text-rc-navy outline-none"
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={!isValid(value) || loading}
          className="bg-rc-green disabled:opacity-40 text-white px-12 py-4 rounded-xl text-2xl font-bold w-full"
        >
          {loading ? 'Adding…' : 'Add to Queue ⛳'}
        </button>
      </form>
      <button onClick={onBack} className="text-slate-400 text-lg underline">
        ← Back
      </button>
    </div>
  )
}
