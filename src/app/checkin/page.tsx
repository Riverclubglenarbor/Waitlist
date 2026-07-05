'use client'
import { useState, useCallback } from 'react'
import Image from 'next/image'
import CheckinWizard from '@/components/checkin/CheckinWizard'
import QueueView from '@/components/checkin/QueueView'

export default function CheckinPage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [addingTime, setAddingTime] = useState(false)
  const [addTimeFlash, setAddTimeFlash] = useState('')
  const [confirmingAddTime, setConfirmingAddTime] = useState(false)
  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  async function addTime() {
    setConfirmingAddTime(false)
    setAddingTime(true)
    try {
      const res = await fetch('/api/settings/add-time', { method: 'POST' })
      if (res.ok) {
        setAddTimeFlash('+5 min added')
        refresh()
      } else {
        setAddTimeFlash('Failed to add time')
      }
    } catch {
      setAddTimeFlash('Network error')
    }
    setAddingTime(false)
    setTimeout(() => setAddTimeFlash(''), 2500)
  }

  return (
    <div className="h-screen flex flex-col bg-[#f5f8f4] overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 bg-white border-b border-slate-200 shrink-0" style={{ height: 56 }}>
        <Image src="/putt-party.png" alt="putt · party · eat · repeat" width={160} height={32} className="object-contain block" style={{ maxHeight: 32 }} />
        <div className="flex items-center gap-3">
          {addTimeFlash && <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">{addTimeFlash}</span>}
          <button
            onClick={() => setConfirmingAddTime(true)}
            disabled={addingTime}
            className="bg-red-500 text-white text-sm font-bold px-4 py-2 rounded-xl
                       transition-all duration-150 hover:bg-red-600 active:scale-[0.97] disabled:opacity-50"
          >
            {addingTime ? '…' : 'Add Time'}
          </button>
        </div>
        <span className="text-slate-400 text-sm font-medium uppercase tracking-widest leading-none">Waitlist</span>
      </header>

      {confirmingAddTime && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl shadow-xl px-8 py-7 max-w-sm w-full text-center">
            <p className="text-rc-navy text-xl font-bold mb-6">Add 5 min to all parties?</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setConfirmingAddTime(false)}
                className="flex-1 border border-slate-300 text-slate-600 font-bold py-3 rounded-xl
                           transition-all duration-150 hover:bg-slate-50 active:scale-[0.97]"
              >
                No
              </button>
              <button
                onClick={addTime}
                className="flex-1 bg-red-500 text-white font-bold py-3 rounded-xl
                           transition-all duration-150 hover:bg-red-600 active:scale-[0.97]"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

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
