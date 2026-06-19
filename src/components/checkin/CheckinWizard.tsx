'use client'
import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import NameStep from './NameStep'
import InitialStep from './InitialStep'
import PartySizeStep from './PartySizeStep'
import PhoneStep from './PhoneStep'
import type { Party } from '@/types'

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
  const [confirmedParties, setConfirmedParties] = useState<Party[] | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [smsEnabled, setSmsEnabled] = useState(false)
  const [state, setState] = useState<WizardState>({
    firstName: '',
    lastInitial: '',
    partySize: 1,
  })

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(settings => setSmsEnabled(settings.sms_enabled === 'true'))
      .catch(() => {})
  }, [])

  async function submitParty(phone?: string) {
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
          ...(phone ? { phone } : {}),
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
    setState({ firstName: '', lastInitial: '', partySize: 1 })
  }

  if (confirmedParties !== null) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-6">
        <div className="text-rc-green text-6xl">✓</div>
        <div className="text-rc-navy text-2xl font-bold">Par-Tee Added!</div>
        <div className="flex flex-wrap items-start justify-center gap-6">
          {confirmedParties.map((party, i) => (
            <div key={party.id} className="flex flex-col items-center gap-2">
              {confirmedParties.length > 1 && (
                <span className="text-rc-navy text-sm font-semibold">
                  Group {i + 1} of {confirmedParties.length}
                </span>
              )}
              <QRCodeSVG value={`https://river-club-waitlist.vercel.app/track/${party.id}`} size={140} />
            </div>
          ))}
        </div>
        <p className="text-slate-400 text-sm text-center max-w-xs">
          Have the customer scan to track their spot
        </p>
        <button
          onClick={handleDone}
          className="bg-rc-green text-white px-8 py-3 rounded-xl font-bold"
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
            if (smsEnabled) {
              setStep('phone')
            } else {
              submitParty()
            }
          }}
          onBack={() => setStep('initial')}
        />
      )}
      {step === 'phone' && (
        <PhoneStep
          onSubmit={phone => submitParty(phone)}
          onBack={() => setStep('size')}
          loading={loading}
        />
      )}
    </div>
  )
}
