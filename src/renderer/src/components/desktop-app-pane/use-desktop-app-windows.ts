import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesktopAppWindow } from '../../../../shared/desktop-app-types'
import { errorMessage } from '../../../../shared/error-message'
import {
  findRememberedWindow,
  readRememberedTarget,
  writeRememberedTarget
} from './desktop-app-target-memory'

// Why: the user can move or resize the real window; its size sets the click mapping.
const WINDOW_REFRESH_MS = 3_000

export type DesktopAppWindowsState = {
  windows: DesktopAppWindow[]
  selected: DesktopAppWindow | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  select: (windowId: number) => void
}

export function useDesktopAppWindows(tabId: string, isActive: boolean): DesktopAppWindowsState {
  const [windows, setWindows] = useState<DesktopAppWindow[]>([])
  const [selected, setSelected] = useState<DesktopAppWindow | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const restoreAttempted = useRef(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await window.api.desktopApp.listWindows()
      setWindows(next)
      setError(null)
      setSelected((current) => {
        if (current) {
          // Why: a chosen window that closed must not hand the user's input to another window.
          return next.find((w) => w.windowId === current.windowId) ?? null
        }
        if (restoreAttempted.current) {
          return null
        }
        restoreAttempted.current = true
        const remembered = readRememberedTarget(tabId)
        return remembered ? findRememberedWindow(next, remembered) : null
      })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [tabId])

  useEffect(() => {
    if (!isActive) {
      return
    }
    void refresh()
    const timer = setInterval(() => void refresh(), WINDOW_REFRESH_MS)
    return () => clearInterval(timer)
  }, [isActive, refresh])

  const select = useCallback(
    (windowId: number) => {
      const next = windows.find((w) => w.windowId === windowId)
      if (!next) {
        return
      }
      setSelected(next)
      writeRememberedTarget(tabId, {
        windowId: next.windowId,
        pid: next.pid,
        appName: next.appName,
        bundleId: next.bundleId,
        title: next.title
      })
    },
    [tabId, windows]
  )

  return { windows, selected, loading, error, refresh, select }
}
