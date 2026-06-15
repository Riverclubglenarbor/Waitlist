import WaitlistBoard from '@/components/waitlist/WaitlistBoard'
import { createServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function WaitlistPage() {
  const supabase = createServerClient()
  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings = Object.fromEntries(
    (settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )
  const avgMinPerHole = parseFloat(settings.avg_min_per_hole ?? '2.5')

  return <WaitlistBoard avgMinPerHole={avgMinPerHole} />
}
