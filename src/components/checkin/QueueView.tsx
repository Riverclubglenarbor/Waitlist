'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { Party } from '@/types'

export default function QueueView() {
  const [parties, setParties] = useState<Party[]>([])

  useEffect(() => {
    fetchParties()
    const supabase = createClient()
    const channel = supabase
      .channel('queue-view')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parties' }, fetchParties)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  async function fetchParties() {
    const res = await fetch('/api/parties')
    const data = await res.json()
    setParties(data)
  }

  async function updateStatus(id: string, status: Party['status']) {
    await fetch(`/api/parties/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    fetchParties()
  }

  if (parties.length === 0) {
    return <p className="text-white/60 text-center mt-12 text-xl">No Par-Tees in queue</p>
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-white text-left">
        <thead>
          <tr className="text-rc-green border-b border-white/20 text-sm uppercase tracking-wider">
            <th className="py-3 px-4">#</th>
            <th className="py-3 px-4">Name</th>
            <th className="py-3 px-4">Size</th>
            <th className="py-3 px-4">Status</th>
            <th className="py-3 px-4">Notes</th>
            <th className="py-3 px-4">Actions</th>
          </tr>
        </thead>
        <tbody>
          {parties.map((party, i) => (
            <tr key={party.id} className="border-b border-white/10 hover:bg-white/5">
              <td className="py-4 px-4 text-rc-green font-bold">{i + 1}</td>
              <td className="py-4 px-4 font-semibold">
                {party.first_name} {party.last_initial}.
              </td>
              <td className="py-4 px-4">{party.party_size}</td>
              <td className="py-4 px-4">
                <span className={`px-2 py-1 rounded text-xs font-bold uppercase
                  ${party.status === 'notified' ? 'bg-yellow-500 text-black' : 'bg-rc-green text-white'}`}>
                  {party.status}
                </span>
              </td>
              <td className="py-4 px-4 text-white/60 text-sm">{party.notes ?? '—'}</td>
              <td className="py-4 px-4 flex gap-2">
                <button
                  onClick={() => updateStatus(party.id, 'playing')}
                  className="bg-rc-green text-white px-3 py-1 rounded text-sm font-bold"
                >
                  Playing
                </button>
                <button
                  onClick={() => updateStatus(party.id, 'no_show')}
                  className="bg-yellow-500 text-black px-3 py-1 rounded text-sm font-bold"
                >
                  No Show
                </button>
                <button
                  onClick={() => updateStatus(party.id, 'removed')}
                  className="bg-red-600 text-white px-3 py-1 rounded text-sm font-bold"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
