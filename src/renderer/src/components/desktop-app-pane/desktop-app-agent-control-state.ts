import type { DesktopAppAgentActivity } from '../../../../shared/desktop-app-types'
import type { Point } from './desktop-app-point-mapping'

// Why: agents think between actions for seconds at a time; dropping the indicator on every gap
// would flash the border, so control stays shown until the agent has been quiet this long.
export const AGENT_CONTROL_IDLE_MS = 20_000

export type DesktopAppAgentControlState = {
  controlling: boolean
  stopped: boolean
  // Last known agent cursor position, in window points.
  cursor: Point | null
  inFlight: number
  lastActivityAt: number
}

export const INITIAL_AGENT_CONTROL_STATE: DesktopAppAgentControlState = {
  controlling: false,
  stopped: false,
  cursor: null,
  inFlight: 0,
  lastActivityAt: 0
}

export type DesktopAppAgentControlEvent =
  | { type: 'activity'; activity: DesktopAppAgentActivity }
  | { type: 'idle'; now: number }
  | { type: 'stop' }
  | { type: 'allow' }
  | { type: 'reset' }
  | { type: 'hydrateStopped' }

export function reduceAgentControl(
  state: DesktopAppAgentControlState,
  event: DesktopAppAgentControlEvent
): DesktopAppAgentControlState {
  switch (event.type) {
    case 'activity': {
      if (state.stopped) {
        return state
      }
      const { activity } = event
      const inFlight =
        activity.phase === 'start' ? state.inFlight + 1 : Math.max(0, state.inFlight - 1)
      return {
        ...state,
        controlling: true,
        cursor: activity.point ?? state.cursor,
        inFlight,
        lastActivityAt: activity.at
      }
    }
    case 'idle':
      if (!state.controlling || state.inFlight > 0) {
        return state
      }
      if (event.now - state.lastActivityAt < AGENT_CONTROL_IDLE_MS) {
        return state
      }
      return { ...state, controlling: false, cursor: null }
    case 'stop':
      return { ...state, controlling: false, stopped: true, cursor: null, inFlight: 0 }
    case 'allow':
      return { ...state, stopped: false }
    case 'hydrateStopped':
      return { ...state, stopped: true }
    case 'reset':
      return INITIAL_AGENT_CONTROL_STATE
  }
}
