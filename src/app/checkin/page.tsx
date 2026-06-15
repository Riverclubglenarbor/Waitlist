'use client'
import { useState } from 'react'
import CheckinWizard from '@/components/checkin/CheckinWizard'
import QueueView from '@/components/checkin/QueueView'

type Tab = 'checkin' | 'queue'

export default function CheckinPage() {
  const [tab, setTab] = useState<Tab>('checkin')

  return (
    <div className="h-screen flex flex-col bg-rc-navy">
      <div className="flex border-b border-white/10">
        {(['checkin', 'queue'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-8 py-4 text-lg font-bold capitalize transition-colors
              ${tab === t ? 'text-rc-green border-b-2 border-rc-green' : 'text-white/50'}`}
          >
            {t === 'checkin' ? 'Check In' : 'Queue'}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-6">
        {tab === 'checkin' && <CheckinWizard onSuccess={() => setTab('queue')} />}
        {tab === 'queue' && <QueueView />}
      </div>
    </div>
  )
}
