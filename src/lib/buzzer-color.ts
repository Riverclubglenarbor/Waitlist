const NAVY = '#1E3A5F'
const GREEN = '#6DC04B'
const GRADIENT_START_POSITION = 8 // position at/beyond which the color is full navy

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function toHexChannel(n: number): string {
  return Math.round(n).toString(16).padStart(2, '0')
}

export function blendHex(from: string, to: string, t: number): string {
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  const r = a.r + (b.r - a.r) * t
  const g = a.g + (b.g - a.g) * t
  const blue = a.b + (b.b - a.b) * t
  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(blue)}`
}

export function buzzerColor(position: number): string {
  const clamped = Math.min(Math.max(position, 1), GRADIENT_START_POSITION)
  const t = 1 - (clamped - 1) / (GRADIENT_START_POSITION - 1)
  return blendHex(NAVY, GREEN, t)
}
