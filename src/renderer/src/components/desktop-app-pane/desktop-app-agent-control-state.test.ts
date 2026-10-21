import { describe, expect, it } from 'vitest'
import type { DesktopAppAgentActivity } from '../../../../shared/desktop-app-types'
import {
  AGENT_CONTROL_IDLE_MS,
  INITIAL_AGENT_CONTROL_STATE,
  reduceAgentControl
} from './desktop-app-agent-control-state'
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

describe('agent control state', () => {
  it('shows control and the cursor while the agent acts, then hides after the idle gap', () => {
    let state = reduceAgentControl(INITIAL_AGENT_CONTROL_STATE, {
      type: 'activity',
      activity: activity({ point: { x: 10, y: 20 } })
    })
    expect(state).toMatchObject({ controlling: true, cursor: { x: 10, y: 20 }, inFlight: 1 })
    state = reduceAgentControl(state, {
      type: 'activity',
      activity: activity({ phase: 'end', at: 2_000 })
    })
    expect(state.inFlight).toBe(0)
    expect(reduceAgentControl(state, { type: 'idle', now: 2_500 }).controlling).toBe(true)
    expect(
      reduceAgentControl(state, { type: 'idle', now: 2_000 + AGENT_CONTROL_IDLE_MS })
    ).toMatchObject({ controlling: false, cursor: null })
  })

  it('ignores activity after the user stops the agent until they allow it again', () => {
    const stopped = reduceAgentControl(INITIAL_AGENT_CONTROL_STATE, { type: 'stop' })
    expect(
      reduceAgentControl(stopped, { type: 'activity', activity: activity({}) }).controlling
    ).toBe(false)
    const allowed = reduceAgentControl(stopped, { type: 'allow' })
    expect(
      reduceAgentControl(allowed, { type: 'activity', activity: activity({}) }).controlling
    ).toBe(true)
  })

  it('shows the stopped state again when main still blocks the app after a remount', () => {
    const hydrated = reduceAgentControl(INITIAL_AGENT_CONTROL_STATE, { type: 'hydrateStopped' })
    expect(hydrated.stopped).toBe(true)
    expect(
      reduceAgentControl(hydrated, { type: 'activity', activity: activity({}) }).controlling
    ).toBe(false)
  })
})
