import { describe, expect, it } from 'vitest'
import {
  describeMissingCaptureSource,
  findWindowCaptureSource
} from './desktop-app-capture-source-match'

describe('findWindowCaptureSource', () => {
  const sources = [{ id: 'window:123:0' }, { id: 'window:12396:0' }, { id: 'screen:1:0' }]

  it('matches the exact CGWindowID, not a prefix of another id', () => {
    expect(findWindowCaptureSource(sources, 12396)).toEqual({ id: 'window:12396:0' })
    expect(findWindowCaptureSource(sources, 123)).toEqual({ id: 'window:123:0' })
    expect(findWindowCaptureSource(sources, 1239)).toBeNull()
  })

  it('never matches screen sources', () => {
    expect(findWindowCaptureSource(sources, 1)).toBeNull()
  })
})

describe('describeMissingCaptureSource', () => {
  it('points at Screen Recording when macOS returned no window sources', () => {
    expect(describeMissingCaptureSource(5, 0)).toContain('Screen Recording')
  })

  it('reports a closed window when other windows are visible', () => {
    expect(describeMissingCaptureSource(5, 3)).toBe(
      'Window 5 is no longer open. Pick the app window again.'
    )
  })
})
