'use client'
import { useState } from 'react'
import NameStep from './NameStep'
import InitialStep from './InitialStep'
import PartySizeStep from './PartySizeStep'
import PhoneStep from './PhoneStep'

type Step = 'name' | 'initial' | 'size' | 'phone'

interface WizardState {
  firstName: string
  lastInitial: string
  partySize: number
}

interface CheckinWizardProps {
  onSuccess: () => void
}

export default function CheckinWizard({ onSuccess }: CheckinWizardProps) {
  const [step, setStep] = useState<Step>('name')
  const [loading, setLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [state, setState] = useState<WizardState>({
    firstName: '',
    lastInitial: '',
    partySize: 1,
  })

  async function handlePhoneSubmit(phone: string) {
    setLoading(true)
    setErrorMsg('')
    try {
      const res = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: state.firstName,
          last_initial: state.lastInitial,
          party_size: state.partySize,
          phone,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setErrorMsg(data.error ?? 'Failed to add party')
        return
      }
      setConfirmed(true)
      onSuccess()
      setTimeout(() => {
        setConfirmed(false)
        setStep('name')
        setState({ firstName: '', lastInitial: '', partySize: 1 })
      }, 1500)
    } catch {
      setErrorMsg('Network error — check connection')
    } finally {
      setLoading(false)
    }
  }

  if (confirmed) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-rc-green text-6xl mb-4">✓</div>
          <div className="text-rc-navy text-2xl font-bold">Par-Tee Added!</div>
        </div>
      </div>
    )
  }

  if (errorMsg) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="text-red-500 text-5xl">⚠️</div>
        <p className="text-rc-navy text-xl font-semibold text-center max-w-xs">{errorMsg}</p>
        <button
          onClick={() => { setErrorMsg(''); setStep('name'); setState({ firstName: '', lastInitial: '', partySize: 1 }) }}
          className="bg-rc-green text-white px-8 py-3 rounded-xl font-bold"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="h-full p-8">
      {step === 'name' && (
        <NameStep
          onNext={firstName => {
            setState(s => ({ ...s, firstName }))
            setStep('initial')
          }}
        />
      )}
      {step === 'initial' && (
        <InitialStep
          firstName={state.firstName}
          onNext={lastInitial => {
            setState(s => ({ ...s, lastInitial }))
            setStep('size')
          }}
          onBack={() => setStep('name')}
        />
      )}
      {step === 'size' && (
        <PartySizeStep
          onNext={partySize => {
            setState(s => ({ ...s, partySize }))
            setStep('phone')
          }}
          onBack={() => setStep('initial')}
        />
      )}
      {step === 'phone' && (
        <PhoneStep
          onSubmit={handlePhoneSubmit}
          onBack={() => setStep('size')}
          loading={loading}
        />
      )}
    </div>
  )
}
