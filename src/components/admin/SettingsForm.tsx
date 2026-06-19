'use client'
import { useEffect, useState } from 'react'
import type { Settings } from '@/types'
import { EMPTY_BOARD_SLIDES } from '@/lib/empty-board-messages'

// Hidden from the admin UI for now — SMS is disabled and being phased out.
// The underlying settings/code stay intact (sms-dispatch, Twilio, the
// sms_enabled checkin-wizard branch) in case it's ever turned back on.
const HIDDEN_FIELDS = [
  'sms_enabled',
  'notification_lead_minutes',
  'no_show_timeout_minutes',
  'welcome_sms_template',
  'notification_sms_template',
  'followup_sms_template',
]

const FIELD_LABELS: Record<string, string> = {
  sms_enabled: 'Collect Phone Number & Send SMS',
  avg_min_per_hole_small: 'Min Per Hole — Small Group (1–4 players)',
  avg_min_per_hole_large: 'Min Per Hole — Large Group (5–6 players)',
  notification_lead_minutes: 'SMS Lead Time (min before tee)',
  no_show_timeout_minutes: 'No-Show Timeout (min after notify)',
  queue_close_time: 'Queue Close Time (HH:MM)',
  daily_reset_time: 'Daily Reset Time (HH:MM)',
  admin_pin: 'Admin PIN',
  welcome_sms_template: 'Welcome SMS',
  notification_sms_template: 'Pre-Tee SMS ("Come grab your putters")',
  followup_sms_template: 'No-Show Follow-Up SMS',
  ...Object.fromEntries(
    EMPTY_BOARD_SLIDES.map((s, i) => [
      s.key,
      `Empty Board — Message ${i + 1}${s.image ? ' (Gringo Loco promo)' : ''}`,
    ])
  ),
}

const FIELD_DEFAULTS: Record<string, string> = {
  sms_enabled: 'false',
  ...Object.fromEntries(
    EMPTY_BOARD_SLIDES.map(s => [s.key, s.defaultText])
  ),
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
      {Object.entries(FIELD_LABELS).filter(([key]) => !HIDDEN_FIELDS.includes(key)).map(([key, label]) => (
        <div key={key} className="flex flex-col gap-1">
          <label className="text-rc-green text-sm font-bold uppercase tracking-wider">
            {label}
          </label>
          {key === 'sms_enabled' ? (
            <input
              type="checkbox"
              checked={(settings[key] ?? FIELD_DEFAULTS[key]) === 'true'}
              onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked ? 'true' : 'false' }))}
              className="w-6 h-6 accent-rc-green self-start"
            />
          ) : key.includes('template') || key.includes('empty_board_message') ? (
            <textarea
              value={settings[key] ?? FIELD_DEFAULTS[key] ?? ''}
              onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
              rows={3}
              className="bg-white/10 text-white rounded-xl p-3 border border-white/20 outline-none focus:border-rc-green resize-none"
            />
          ) : (
            <input
              value={settings[key] ?? FIELD_DEFAULTS[key] ?? ''}
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
