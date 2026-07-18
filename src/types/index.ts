export type PartyStatus = 'waiting' | 'notified' | 'no_show' | 'playing' | 'removed'

export interface Party {
  id: string
  first_name: string
  last_initial: string
  party_size: number
  phone: string | null
  paid: boolean
  notes?: string
  checked_in_at: string
  notified_at?: string
  followup_sent_at?: string
  // Set on the party who moved UP as the result of a voluntary swap-down by
  // the party ahead of them (POST /api/parties/[id]/swap-down). Drives the
  // one-time "You got moved up!" banner on their tracking page.
  moved_up_notice_at?: string
  status: PartyStatus
}

export interface TeeTyme {
  id: string
  scheduled_at: string
  party_size: number
  notes?: string
}

export type Settings = Record<string, string>

export interface AnalyticsData {
  total_served: number
  avg_wait_minutes: number
  busiest_hour: number | null
  by_status: Record<PartyStatus, number>
}
