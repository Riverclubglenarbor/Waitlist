'use client'

const SLOT_HEIGHT_REM = 7
const SLOT_WIDTH_REM = 5.2
const FONT_SIZE_REM = 7

function DigitSlot({ digit }: { digit: number }) {
  return (
    <div
      className="relative overflow-hidden shrink-0"
      style={{ width: `${SLOT_WIDTH_REM}rem`, height: `${SLOT_HEIGHT_REM}rem` }}
    >
      <div
        className="absolute top-0 left-0 w-full transition-transform duration-500 ease-out"
        style={{ transform: `translateY(-${digit * SLOT_HEIGHT_REM}rem)` }}
      >
        {Array.from({ length: 10 }, (_, d) => (
          <div
            key={d}
            className="flex items-center justify-center font-black text-rc-green leading-none"
            style={{ height: `${SLOT_HEIGHT_REM}rem`, fontSize: `${FONT_SIZE_REM}rem` }}
          >
            {d}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function OdometerNumber({ value, maxDigits = 3 }: { value: number; maxDigits?: number }) {
  const clamped = Math.max(0, Math.round(value))
  const digits = String(clamped).split('').map(ch => parseInt(ch, 10))

  return (
    <div
      className="flex items-center justify-center shrink-0"
      style={{ width: `${maxDigits * SLOT_WIDTH_REM}rem`, height: `${SLOT_HEIGHT_REM}rem` }}
    >
      <div className="flex">
        {digits.map((d, i) => (
          // Key by position from the right (ones, tens, hundreds...) so each
          // place value keeps its identity — and its roll animation — as the
          // digit count grows or shrinks, instead of remounting everything.
          <DigitSlot key={digits.length - 1 - i} digit={d} />
        ))}
      </div>
    </div>
  )
}
