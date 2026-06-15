'use client'
import { useState, useEffect } from 'react'

interface PinGateProps {
  children: React.ReactNode
  storageKey?: string
}

export default function PinGate({ children, storageKey = 'rc_pin_verified' }: PinGateProps) {
  const [verified, setVerified] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem(storageKey) === 'true') setVerified(true)
  }, [storageKey])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/settings')
    const settings = await res.json()
    if (input === settings.admin_pin) {
      sessionStorage.setItem(storageKey, 'true')
      setVerified(true)
    } else {
      setError(true)
      setInput('')
      setTimeout(() => setError(false), 1500)
    }
  }

  if (verified) return <>{children}</>

  return (
    <div className="min-h-screen bg-rc-navy flex items-center justify-center">
      <form onSubmit={handleSubmit} className="flex flex-col items-center gap-6">
        <div className="text-rc-green text-4xl font-bold tracking-widest">RIVER CLUB</div>
        <input
          type="password"
          inputMode="numeric"
          placeholder="Enter PIN"
          value={input}
          onChange={e => setInput(e.target.value)}
          className={`text-center text-2xl w-48 p-4 rounded-xl border-4 outline-none
            ${error ? 'border-red-500' : 'border-rc-green'}
            bg-white text-rc-navy`}
          autoFocus
        />
        <button
          type="submit"
          className="bg-rc-green text-white px-8 py-3 rounded-xl text-xl font-bold"
        >
          Enter
        </button>
      </form>
    </div>
  )
}
