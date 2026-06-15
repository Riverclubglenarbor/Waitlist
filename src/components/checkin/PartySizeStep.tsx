'use client'

interface PartySizeStepProps {
  onNext: (size: number) => void
  onBack: () => void
}

const SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

export default function PartySizeStep({ onNext, onBack }: PartySizeStepProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-8">
      <div className="text-center">
        <h2 className="text-rc-navy text-3xl font-bold">Party Size?</h2>
        <p className="text-slate-400 text-sm mt-1">Groups over 6 are auto-split into separate tee times</p>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {SIZES.map(n => (
          <button
            key={n}
            onClick={() => onNext(n)}
            className={`w-18 h-18 p-5 text-white text-2xl font-bold rounded-2xl transition-all active:scale-[0.97]
              ${n <= 6 ? 'bg-rc-green hover:bg-green-500' : 'bg-rc-navy hover:bg-navy-700'}`}
          >
            {n}
          </button>
        ))}
      </div>
      <button onClick={onBack} className="text-slate-400 text-lg underline">
        ← Back
      </button>
    </div>
  )
}
