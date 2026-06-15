import { describe, it, expect } from 'vitest'
import { interpolate } from '@/lib/sms-templates'

describe('interpolate', () => {
  it('replaces a single variable', () => {
    expect(interpolate('Hello {name}!', { name: 'Jane' })).toBe('Hello Jane!')
  })

  it('replaces multiple variables', () => {
    const result = interpolate('Hi {name}, wait is {wait} min', {
      name: 'Jane',
      wait: 12,
    })
    expect(result).toBe('Hi Jane, wait is 12 min')
  })

  it('leaves unknown variables as-is', () => {
    expect(interpolate('Hello {unknown}', {})).toBe('Hello {unknown}')
  })

  it('handles numeric values', () => {
    expect(interpolate('Wait: {wait}', { wait: 0 })).toBe('Wait: 0')
  })

  it('handles empty template', () => {
    expect(interpolate('', { name: 'Jane' })).toBe('')
  })
})
