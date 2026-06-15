'use client'

interface PartySizeStepProps {
  onNext: (size: number) => void
  onBack: () => void
}

const SIZES = [1, 2, 3, 4, 5, 6, 7, 8]

export default function PartySizeStep({ onNext, onBack }: PartySizeStepProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-8">
      <h2 className="text-rc-navy text-3xl font-bold">Party Size?</h2>
      <div className="grid grid-cols-4 gap-4">
        {SIZES.map(n => (
          <button
            key={n}
            onClick={() => onNext(n)}
            className="w-20 h-20 bg-rc-green hover:bg-green-400 active:scale-95
                       text-white text-3xl font-bold rounded-2xl transition-all"
          >
            {n}
          </button>
        ))}
        <button
          onClick={() => onNext(9)}
          className="col-span-4 h-16 bg-rc-green hover:bg-green-400 active:scale-95
                     text-white text-2xl font-bold rounded-2xl transition-all"
        >
          9+ Large Group
        </button>
      </div>
      <button onClick={onBack} className="text-slate-400 text-lg underline">
        ← Back
      </button>
    </div>
  )
}
