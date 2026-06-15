import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createServerClient()
  const { data, error } = await supabase.from('settings').select('*')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const settings = Object.fromEntries(data.map((r: { key: string; value: string }) => [r.key, r.value]))
  return NextResponse.json(settings)
}

export async function PUT(request: Request) {
  const supabase = createServerClient()
  const updates: Record<string, string> = await request.json()

  const upserts = Object.entries(updates).map(([key, value]) => ({ key, value }))
  const { error } = await supabase.from('settings').upsert(upserts)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
