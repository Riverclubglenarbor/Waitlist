export type PartyStatus = 'waiting' | 'notified' | 'no_show' | 'playing' | 'removed'

export interface Party {
  id: string
  first_name: string
  last_initial: string
  party_size: number
  phone: string | null
  notes?: string
  checked_in_at: string
  notified_at?: string
  followup_sent_at?: string
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
