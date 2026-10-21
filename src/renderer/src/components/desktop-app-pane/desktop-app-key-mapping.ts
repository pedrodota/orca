import type { DesktopAppInput } from '../../../../shared/desktop-app-types'

export type DesktopAppKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'
>

// DOM `key` → the computer-use key grammar (native KeyMap names).
const NAMED_KEYS: Record<string, string> = {
  Enter: 'return',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'forwarddelete',
  Escape: 'escape',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ' ': 'space'
}

// Command shortcuts the pane forwards; every other ⌘ chord stays with Orca (new tab, close tab…).
// ⌘V is absent on purpose: the pane's paste event sends the clipboard text instead.
const FORWARDED_COMMAND_KEYS = new Set(['a', 'c', 'x', 'z', 'f'])

/** Null when the key belongs to Orca or is a bare modifier. */
export function mapKeyEventToDesktopAppInput(event: DesktopAppKeyEvent): DesktopAppInput | null {
  if (event.isComposing || ['Meta', 'Control', 'Alt', 'Shift', 'CapsLock'].includes(event.key)) {
    return null
  }
  const named = NAMED_KEYS[event.key]
  const lower = event.key.length === 1 ? event.key.toLowerCase() : null
  if (event.metaKey) {
    if (!lower || !FORWARDED_COMMAND_KEYS.has(lower) || event.ctrlKey) {
      return null
    }
    return { kind: 'key', key: `${event.shiftKey ? 'shift+' : ''}cmd+${lower}` }
  }
  if (event.ctrlKey || (event.altKey && named)) {
    const base = named ?? lower
    if (!base) {
      return null
    }
    const modifiers = [
      event.ctrlKey ? 'ctrl' : null,
      event.altKey ? 'alt' : null,
      event.shiftKey ? 'shift' : null
    ].filter(Boolean)
    return { kind: 'key', key: [...modifiers, base].join('+') }
  }
  if (named) {
    if (named === 'space') {
      return { kind: 'text', text: ' ' }
    }
    return { kind: 'key', key: event.shiftKey ? `shift+${named}` : named }
  }
  // Printable characters (already shifted / option-composed by the OS layout) go as text.
  if ([...event.key].length === 1) {
    return { kind: 'text', text: event.key }
  }
  return null
}
