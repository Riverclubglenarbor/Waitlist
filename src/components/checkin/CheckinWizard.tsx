'use client'
import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import NameStep from './NameStep'
import InitialStep from './InitialStep'
import PartySizeStep from './PartySizeStep'
import PhoneStep from './PhoneStep'
import PaidStep from './PaidStep'
import type { Party } from '@/types'

type Step = 'name' | 'initial' | 'size' | 'phone' | 'paid'

interface WizardState {
  firstName: string
  lastInitial: string
  partySize: number
  phone?: string
}

interface CheckinWizardProps {
  onSuccess: () => void
}

const initialWizardState: WizardState = {
  firstName: '',
  lastInitial: '',
  partySize: 1,
}

export default function CheckinWizard({ onSuccess }: CheckinWizardProps) {
  const [step, setStep] = useState<Step>('name')
  const [loading, setLoading] = useState(false)
  const [confirmedParties, setConfirmedParties] = useState<Party[] | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [smsEnabled, setSmsEnabled] = useState(false)
  const [state, setState] = useState<WizardState>(initialWizardState)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(settings => setSmsEnabled(settings.sms_enabled === 'true'))
      .catch(() => {})
  }, [])

  async function submitParty(paid: boolean) {
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
          paid,
          ...(state.phone ? { phone: state.phone } : {}),
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setErrorMsg(data.error ?? 'Failed to add party')
        return
      }
      const inserted: Party[] = await res.json()
      if (!Array.isArray(inserted)) {
        setErrorMsg('Unexpected response — please try again')
        return
      }
      setConfirmedParties(inserted)
      onSuccess()
    } catch {
      setErrorMsg('Network error — check connection')
    } finally {
      setLoading(false)
    }
  }

  function handleDone() {
    setConfirmedParties(null)
    setStep('name')
    setState(initialWizardState)
  }

  if (confirmedParties !== null) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-6 animate-pop-in motion-reduce:animate-none">
        <div className="text-rc-green text-6xl">✓</div>
        <div className="text-rc-navy text-2xl font-bold">Par-Tee Added!</div>
        <p className="text-rc-green text-sm font-bold uppercase tracking-wider">
          Show this to the guest
        </p>
        <div className="flex flex-wrap items-start justify-center gap-6">
          {confirmedParties.map((party, i) => (
            <div
              key={party.id}
              className="flex flex-col items-center gap-2 animate-pop-in motion-reduce:animate-none"
              style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'backwards' }}
            >
              {confirmedParties.length > 1 && (
                <span className="text-rc-navy text-sm font-semibold">
                  Group {i + 1} of {confirmedParties.length}
                </span>
              )}
              <QRCodeSVG value={`https://river-club-waitlist.vercel.app/track/${party.id}`} size={140} />
            </div>
          ))}
        </div>
        <button
          onClick={handleDone}
          className="bg-rc-green text-white px-8 py-3 rounded-xl font-bold
                     transition-all duration-150 active:scale-[0.97] motion-reduce:active:scale-100"
        >
          Done
        </button>
      </div>
    )
  }

  if (errorMsg) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="text-red-500 text-5xl">⚠️</div>
        <p className="text-rc-navy text-xl font-semibold text-center max-w-xs">{errorMsg}</p>
        <button
          onClick={() => { setErrorMsg(''); setStep('name'); setState(initialWizardState) }}
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
            setStep(smsEnabled ? 'phone' : 'paid')
          }}
          onBack={() => setStep('initial')}
        />
      )}
      {step === 'phone' && (
        <PhoneStep
          onSubmit={phone => {
            setState(s => ({ ...s, phone }))
            setStep('paid')
          }}
          onBack={() => setStep('size')}
        />
      )}
      {step === 'paid' && (
        <PaidStep
          onNext={paid => submitParty(paid)}
          onBack={() => setStep(smsEnabled ? 'phone' : 'size')}
          loading={loading}
        />
      )}
    </div>
  )
}
