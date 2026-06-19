'use client'

interface PaidStepProps {
  onNext: (paid: boolean) => void
  onBack: () => void
  loading: boolean
}

export default function PaidStep({ onNext, onBack, loading }: PaidStepProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-8">
      <h2 className="text-rc-navy text-3xl font-bold">Have They Paid?</h2>
      <div className="flex gap-4 w-full max-w-sm">
        <button
          onClick={() => onNext(true)}
          disabled={loading}
          className="flex-1 bg-rc-green disabled:opacity-40 text-white px-8 py-6 rounded-2xl text-2xl font-bold
                     transition-all active:scale-[0.97]"
        >
          {loading ? 'Adding…' : 'Yes'}
        </button>
        <button
          onClick={() => onNext(false)}
          disabled={loading}
          className="flex-1 bg-rc-navy disabled:opacity-40 text-white px-8 py-6 rounded-2xl text-2xl font-bold
                     transition-all active:scale-[0.97]"
        >
          {loading ? 'Adding…' : 'No'}
        </button>
      </div>
      <button onClick={onBack} className="text-slate-400 text-lg underline">
        ← Back
      </button>
    </div>
  )
}
