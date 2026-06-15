'use client'
import { useState } from 'react'
import PinGate from '@/components/ui/PinGate'
import SettingsForm from '@/components/admin/SettingsForm'
import AnalyticsDashboard from '@/components/admin/AnalyticsDashboard'

type Tab = 'settings' | 'analytics'

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('settings')

  return (
    <PinGate storageKey="rc_admin_verified">
      <div className="min-h-screen bg-rc-navy text-white p-8">
        <h1 className="text-rc-green text-3xl font-black mb-8 tracking-wider">
          RIVER CLUB — Admin
        </h1>
        <div className="flex gap-4 mb-8 border-b border-white/10 pb-4">
          {(['settings', 'analytics'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-6 py-2 rounded-xl font-bold capitalize transition-colors
                ${tab === t ? 'bg-rc-green text-white' : 'text-white/50'}`}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === 'settings' && <SettingsForm />}
        {tab === 'analytics' && <AnalyticsDashboard />}
      </div>
    </PinGate>
  )
}
