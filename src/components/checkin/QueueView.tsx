'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { Party } from '@/types'

type ActionState = { id: string; type: 'checkin' | 'resend' | 'noshow' | 'remove' } | null

interface QueueViewProps {
  refreshKey?: number
}

export default function QueueView({ refreshKey }: QueueViewProps) {
  const [parties, setParties] = useState<Party[]>([])
  const [loading, setLoading] = useState<ActionState>(null)
  const [flash, setFlash] = useState<{ id: string; type: 'success' | 'error'; msg: string } | null>(null)

  const fetchParties = useCallback(async () => {
    const res = await fetch('/api/parties')
    const data = await res.json()
    if (Array.isArray(data)) setParties(data)
  }, [])

  useEffect(() => {
    fetchParties()
    const supabase = createClient()
    const channel = supabase
      .channel('queue-view')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parties' }, () => fetchParties())
      .subscribe()
    const poll = setInterval(() => fetchParties(), 3000)
    return () => { supabase.removeChannel(channel); clearInterval(poll) }
  }, [fetchParties])

  useEffect(() => {
    if (refreshKey !== undefined) fetchParties()
  }, [refreshKey, fetchParties])

  function showFlash(id: string, type: 'success' | 'error', msg: string) {
    setFlash({ id, type, msg })
    setTimeout(() => setFlash(null), 2500)
  }

  async function checkIn(id: string) {
    setLoading({ id, type: 'checkin' })
    await fetch(`/api/parties/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'playing' }),
    })
    setLoading(null)
    fetchParties()
  }

  async function resend(id: string) {
    setLoading({ id, type: 'resend' })
    const res = await fetch(`/api/parties/${id}/resend`, { method: 'POST' })
    setLoading(null)
    if (res.ok) {
      showFlash(id, 'success', 'Text sent!')
    } else {
      showFlash(id, 'error', 'Failed to send')
    }
  }

  async function noShow(id: string) {
    setLoading({ id, type: 'noshow' })
    await fetch(`/api/parties/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'no_show' }),
    })
    setLoading(null)
    fetchParties()
  }

  async function remove(id: string) {
    setLoading({ id, type: 'remove' })
    await fetch(`/api/parties/${id}`, { method: 'DELETE' })
    setLoading(null)
    fetchParties()
  }

  if (parties.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-20">
        <span className="text-5xl">⛳</span>
        <p className="text-slate-400 text-lg font-medium">No Par-Tees in queue</p>
        <p className="text-slate-300 text-sm">Add a group using the form →</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {parties.map((party, i) => {
        const isLoading = loading?.id === party.id
        const partyFlash = flash?.id === party.id ? flash : null

        return (
          <div
            key={party.id}
            className={`bg-white rounded-2xl border transition-all duration-200 animate-pop-in
              ${i === 0 ? 'border-rc-green shadow-md shadow-rc-green/10' : 'border-slate-200 shadow-sm'}`}
          >
            <div className="flex items-center gap-4 px-5 py-4">
              {/* Position */}
              <span className={`text-3xl font-black w-8 shrink-0
                ${i === 0 ? 'text-rc-green' : 'text-slate-300'}`}>
                {i + 1}
              </span>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-rc-navy text-xl font-bold truncate">
                  {party.first_name} {party.last_initial}.
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-slate-400 text-sm">{party.party_size} {party.party_size === 1 ? 'person' : 'people'}</span>
                  <span className="text-slate-200">·</span>
                  <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full
                    ${party.status === 'notified' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {party.status}
                  </span>
                  {partyFlash && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full transition-opacity
                      ${partyFlash.type === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {partyFlash.msg}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => checkIn(party.id)}
                  disabled={!!loading}
                  className="flex items-center gap-1.5 bg-rc-green text-white text-sm font-bold
                             px-4 py-2 rounded-xl transition-all duration-150
                             hover:bg-green-500 active:scale-[0.97] disabled:opacity-40"
                >
                  {isLoading && loading?.type === 'checkin' ? '…' : '✓ Check In'}
                </button>

                <button
                  onClick={() => resend(party.id)}
                  disabled={!!loading}
                  className="flex items-center gap-1.5 border border-rc-navy text-rc-navy text-sm font-semibold
                             px-3 py-2 rounded-xl transition-all duration-150
                             hover:bg-rc-navy hover:text-white active:scale-[0.97] disabled:opacity-40"
                >
                  {isLoading && loading?.type === 'resend' ? '…' : '↩ Resend'}
                </button>

                <button
                  onClick={() => noShow(party.id)}
                  disabled={!!loading}
                  className="border border-amber-400 text-amber-600 text-sm font-semibold
                             px-3 py-2 rounded-xl transition-all duration-150
                             hover:bg-amber-50 active:scale-[0.97] disabled:opacity-40"
                >
                  {isLoading && loading?.type === 'noshow' ? '…' : 'No Show'}
                </button>

                <button
                  onClick={() => remove(party.id)}
                  disabled={!!loading}
                  className="text-red-400 text-sm font-semibold px-2 py-2 rounded-xl
                             transition-all duration-150 hover:text-red-600 hover:bg-red-50
                             active:scale-[0.97] disabled:opacity-40"
                >
                  {isLoading && loading?.type === 'remove' ? '…' : 'Remove'}
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
