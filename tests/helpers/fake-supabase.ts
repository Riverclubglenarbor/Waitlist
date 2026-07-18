import type { Party } from '@/types'

// In-memory fake of the small slice of the Supabase client API the API
// routes use: from().select/update/delete/insert/upsert with eq/in/order/
// single chaining, plus rpc('advance_queue_epoch') implementing the same
// semantics as the real Postgres function (see
// supabase/migrations/*advance_queue_epoch*): read current epoch
// (defaulting to now() when unset), add delta_minutes, store — atomically,
// which in a single-threaded test is free.

type Row = Record<string, unknown>

interface BuilderState {
  op: 'select' | 'update' | 'delete'
  update: Row | null
  filters: ((row: Row) => boolean)[]
  single: boolean
}

export interface FakeSupabase {
  client: unknown
  db: { parties: Party[]; settings: { key: string; value: string }[] }
  rpcCalls: { name: string; args: { delta_minutes: number } }[]
  getSetting: (key: string) => string | undefined
}

export function makeFakeSupabase(
  initialParties: Party[],
  initialSettings: Record<string, string> = {},
  opts: { failRpc?: boolean } = {}
): FakeSupabase {
  const db = {
    parties: initialParties.map(p => ({ ...p })) as Party[],
    settings: Object.entries(initialSettings).map(([key, value]) => ({ key, value })),
  }
  const rpcCalls: { name: string; args: { delta_minutes: number } }[] = []

  function makeBuilder(table: 'parties' | 'settings') {
    const state: BuilderState = { op: 'select', update: null, filters: [], single: false }
    const exec = () => {
      const matched = (db[table] as Row[]).filter(r => state.filters.every(f => f(r)))
      if (state.op === 'update') {
        matched.forEach(r => Object.assign(r, state.update))
      } else if (state.op === 'delete') {
        if (table === 'parties') {
          db.parties = db.parties.filter(r => !matched.includes(r as Row))
        } else {
          db.settings = db.settings.filter(r => !matched.includes(r as Row))
        }
      }
      if (state.single) {
        if (matched.length === 1) return { data: { ...matched[0] }, error: null }
        return { data: null, error: { code: 'PGRST116', message: `expected 1 row, got ${matched.length}` } }
      }
      return { data: matched.map(r => ({ ...r })), error: null }
    }
    const builder = {
      select: () => builder,
      update: (vals: Row) => { state.op = 'update'; state.update = vals; return builder },
      delete: () => { state.op = 'delete'; return builder },
      insert: (vals: Row) => {
        ;(db[table] as Row[]).push({ ...vals })
        return builder
      },
      upsert: (records: { key: string; value: string }[]) => {
        records.forEach(rec => {
          const existing = db.settings.find(r => r.key === rec.key)
          if (existing) existing.value = rec.value
          else db.settings.push({ ...rec })
        })
        return Promise.resolve({ data: null, error: null })
      },
      eq: (col: string, val: unknown) => { state.filters.push(r => r[col] === val); return builder },
      in: (col: string, vals: unknown[]) => { state.filters.push(r => vals.includes(r[col])); return builder },
      order: () => builder,
      single: () => { state.single = true; return builder },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(exec()).then(resolve, reject),
    }
    return builder
  }

  const client = {
    from: (table: string) => makeBuilder(table as 'parties' | 'settings'),
    rpc: (name: string, args: { delta_minutes: number }) => {
      rpcCalls.push({ name, args })
      if (opts.failRpc) return Promise.resolve({ data: null, error: { message: 'boom' } })
      if (name !== 'advance_queue_epoch') {
        return Promise.resolve({ data: null, error: { message: `unknown function ${name}` } })
      }
      const existing = db.settings.find(r => r.key === 'queue_epoch_at')
      const currentMs = existing ? new Date(existing.value).getTime() : Date.now()
      const nextIso = new Date(currentMs + args.delta_minutes * 60_000).toISOString()
      if (existing) existing.value = nextIso
      else db.settings.push({ key: 'queue_epoch_at', value: nextIso })
      return Promise.resolve({ data: nextIso, error: null })
    },
  }

  return {
    client,
    db,
    rpcCalls,
    getSetting: (key: string) => db.settings.find(r => r.key === key)?.value,
  }
}
