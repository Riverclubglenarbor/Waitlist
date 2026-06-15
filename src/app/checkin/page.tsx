'use client'
import { useState, useCallback } from 'react'
import Image from 'next/image'
import CheckinWizard from '@/components/checkin/CheckinWizard'
import QueueView from '@/components/checkin/QueueView'

export default function CheckinPage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  return (
    <div className="h-screen flex flex-col bg-[#f5f8f4] overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 bg-white border-b border-slate-200 shrink-0" style={{ height: 56 }}>
        <Image src="/putt-party.png" alt="putt · party · eat · repeat" width={160} height={32} className="object-contain block" style={{ maxHeight: 32 }} />
        <span className="text-slate-400 text-sm font-medium uppercase tracking-widest leading-none">Waitlist</span>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: queue */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-slate-200">
          <div className="px-6 py-4 bg-white border-b border-slate-100 shrink-0">
            <h2 className="text-rc-navy text-base font-bold uppercase tracking-widest">Queue</h2>
          </div>
          <div className="flex-1 overflow-auto p-5 bg-[#f5f8f4]">
            <QueueView refreshKey={refreshKey} />
          </div>
        </div>

        {/* Right: add group */}
        <div className="w-[400px] flex flex-col overflow-hidden bg-white">
          <div className="px-6 py-4 border-b border-slate-100 shrink-0">
            <h2 className="text-rc-navy text-base font-bold uppercase tracking-widest">Add Par-Tee</h2>
          </div>
          <div className="flex-1 overflow-auto">
            <CheckinWizard onSuccess={refresh} />
          </div>
        </div>
      </div>
    </div>
  )
}
