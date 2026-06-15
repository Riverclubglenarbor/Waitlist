'use client'
import { useEffect, useState } from 'react'
import type { Settings } from '@/types'

const FIELD_LABELS: Record<string, string> = {
  avg_min_per_hole: 'Avg Minutes Per Hole',
  notification_lead_minutes: 'SMS Lead Time (min before tee)',
  no_show_timeout_minutes: 'No-Show Timeout (min after notify)',
  queue_close_time: 'Queue Close Time (HH:MM)',
  daily_reset_time: 'Daily Reset Time (HH:MM)',
  admin_pin: 'Admin PIN',
  welcome_sms_template: 'Welcome SMS',
  notification_sms_template: 'Pre-Tee SMS ("Come grab your putters")',
  followup_sms_template: 'No-Show Follow-Up SMS',
}

export default function SettingsForm() {
  const [settings, setSettings] = useState<Settings>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(setSettings)
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6 max-w-2xl">
      {Object.entries(FIELD_LABELS).map(([key, label]) => (
        <div key={key} className="flex flex-col gap-1">
          <label className="text-rc-green text-sm font-bold uppercase tracking-wider">
            {label}
          </label>
          {key.includes('template') ? (
            <textarea
              value={settings[key] ?? ''}
              onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
              rows={3}
              className="bg-white/10 text-white rounded-xl p-3 border border-white/20 outline-none focus:border-rc-green resize-none"
            />
          ) : (
            <input
              value={settings[key] ?? ''}
              onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
              className="bg-white/10 text-white rounded-xl p-3 border border-white/20 outline-none focus:border-rc-green"
            />
          )}
        </div>
      ))}
      <p className="text-white/40 text-xs">
        Variables: {'{name}'} {'{wait}'} {'{position}'}
      </p>
      <button
        type="submit"
        disabled={saving}
        className="bg-rc-green text-white py-3 px-8 rounded-xl font-bold text-lg self-start"
      >
        {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Settings'}
      </button>
    </form>
  )
}
