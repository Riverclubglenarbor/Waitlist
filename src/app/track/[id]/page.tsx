import PersonalTrackBoard from '@/components/track/PersonalTrackBoard'

export const dynamic = 'force-dynamic'

export default function PersonalTrackPage({ params }: { params: { id: string } }) {
  return <PersonalTrackBoard id={params.id} />
}
