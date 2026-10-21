import type {
  DesktopAppAgentActivity,
  DesktopAppWindow
} from '../../../../shared/desktop-app-types'

export type DesktopAppPaneTarget = Pick<
  DesktopAppWindow,
  'windowId' | 'pid' | 'appName' | 'bundleId'
>

/** Whether an agent's computer-use action is aimed at the app this pane shows. */
export function activityTargetsPane(
  activity: DesktopAppAgentActivity,
  target: DesktopAppPaneTarget
): boolean {
  if (activity.windowId !== null && activity.windowId !== target.windowId) {
    // Another window of the same app is not this pane's window.
    return false
  }
  if (activity.pid !== null) {
    return activity.pid === target.pid
  }
  if (activity.windowId !== null) {
    return true
  }
  return selectorNamesApp(activity.appSelector, target)
}

function selectorNamesApp(selector: string | null, target: DesktopAppPaneTarget): boolean {
  if (!selector) {
    return false
  }
  const value = selector.trim().toLowerCase()
  const pidMatch = /^pid:(\d+)$/.exec(value)
  if (pidMatch) {
    return Number(pidMatch[1]) === target.pid
  }
  return (
    value === target.appName.toLowerCase() ||
    (target.bundleId !== null && value === target.bundleId.toLowerCase())
  )
}
