import { describe, expect, it } from 'vitest'
import type { DesktopAppAgentActivity } from '../../../../shared/desktop-app-types'
import { activityTargetsPane, type DesktopAppPaneTarget } from './desktop-app-agent-activity-match'

const PEPPER: DesktopAppPaneTarget = {
  windowId: 12396,
  pid: 62961,
  appName: 'PEPPER',
  bundleId: 'app.moovefy.pepper'
}

function activity(overrides: Partial<DesktopAppAgentActivity>): DesktopAppAgentActivity {
  return {
    phase: 'start',
    activityId: 'a1',
    method: 'computer.click',
    appSelector: null,
    pid: null,
    windowId: null,
    point: null,
    ok: null,
    at: 1_000,
    ...overrides
  }
}

describe('agent activity matching', () => {
  it('matches by pid, window id or app selector', () => {
    expect(activityTargetsPane(activity({ pid: 62961 }), PEPPER)).toBe(true)
    expect(activityTargetsPane(activity({ windowId: 12396 }), PEPPER)).toBe(true)
    expect(activityTargetsPane(activity({ appSelector: 'pepper' }), PEPPER)).toBe(true)
    expect(activityTargetsPane(activity({ appSelector: 'app.moovefy.pepper' }), PEPPER)).toBe(true)
    expect(activityTargetsPane(activity({ appSelector: 'pid:62961' }), PEPPER)).toBe(true)
  })

  it('rejects other apps and other windows of the same app', () => {
    expect(activityTargetsPane(activity({ appSelector: 'Safari' }), PEPPER)).toBe(false)
    expect(activityTargetsPane(activity({ pid: 62961, windowId: 1 }), PEPPER)).toBe(false)
    expect(activityTargetsPane(activity({}), PEPPER)).toBe(false)
  })
})
