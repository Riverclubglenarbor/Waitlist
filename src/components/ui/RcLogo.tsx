interface RcLogoProps {
  className?: string
  variant?: 'full' | 'mark-only'
}

export default function RcLogo({ className = '', variant = 'full' }: RcLogoProps) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <span
        className="font-black tracking-[0.3em] text-rc-green uppercase"
        style={{ fontFamily: 'Impact, sans-serif', letterSpacing: '0.35em' }}
      >
        RIVER CLUB
      </span>
      {variant === 'full' && (
        <span className="text-rc-navy italic text-sm mt-1">Glen Arbor, Michigan</span>
      )}
    </div>
  )
}
