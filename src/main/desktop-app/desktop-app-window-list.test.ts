import { describe, expect, it } from 'vitest'
import { parseDesktopAppWindows } from './desktop-app-window-list'

describe('parseDesktopAppWindows', () => {
  it('keeps well-formed windows and drops malformed entries', () => {
    expect(
      parseDesktopAppWindows({
        windows: [
          {
            windowId: 12396,
            pid: 62961,
            appName: 'PEPPER',
            bundleId: null,
            title: 'PEPPER',
            bounds: { x: 2110, y: -60, width: 1280, height: 1016 }
          },
          { windowId: 'x', pid: 1, appName: 'Bad', bounds: {} },
          null
        ]
      })
    ).toEqual([
      {
        windowId: 12396,
        pid: 62961,
        appName: 'PEPPER',
        bundleId: null,
        title: 'PEPPER',
        bounds: { x: 2110, y: -60, width: 1280, height: 1016 }
      }
    ])
  })

  it('returns an empty list for unexpected payloads', () => {
    expect(parseDesktopAppWindows(undefined)).toEqual([])
    expect(parseDesktopAppWindows({ windows: 'nope' })).toEqual([])
  })
})
