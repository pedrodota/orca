import { describe, expect, it } from 'vitest'
import { mapKeyEventToDesktopAppInput, type DesktopAppKeyEvent } from './desktop-app-key-mapping'

function key(overrides: Partial<DesktopAppKeyEvent>): DesktopAppKeyEvent {
  return {
    key: 'a',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...overrides
  }
}

describe('desktop app key mapping', () => {
  it('sends printable characters as text', () => {
    expect(mapKeyEventToDesktopAppInput(key({ key: 'ç' }))).toEqual({ kind: 'text', text: 'ç' })
    expect(mapKeyEventToDesktopAppInput(key({ key: 'A', shiftKey: true }))).toEqual({
      kind: 'text',
      text: 'A'
    })
  })

  it('maps named keys to the computer-use grammar', () => {
    expect(mapKeyEventToDesktopAppInput(key({ key: 'Enter' }))).toEqual({
      kind: 'key',
      key: 'return'
    })
    expect(mapKeyEventToDesktopAppInput(key({ key: 'Tab', shiftKey: true }))).toEqual({
      kind: 'key',
      key: 'shift+tab'
    })
  })

  it('forwards editing shortcuts and leaves Orca shortcuts alone', () => {
    expect(mapKeyEventToDesktopAppInput(key({ key: 'a', metaKey: true }))).toEqual({
      kind: 'key',
      key: 'cmd+a'
    })
    expect(mapKeyEventToDesktopAppInput(key({ key: 't', metaKey: true }))).toBeNull()
    expect(mapKeyEventToDesktopAppInput(key({ key: 'Meta', metaKey: true }))).toBeNull()
  })
})
