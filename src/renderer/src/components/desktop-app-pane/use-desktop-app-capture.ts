import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { DesktopAppTarget } from '../../../../shared/desktop-app-types'
import { errorMessage } from '../../../../shared/error-message'

export type DesktopAppCaptureState = {
  stream: MediaStream | null
  error: string | null
}

// Why: main arms one window per renderer, so two panes must not interleave prepare and
// getDisplayMedia or one pane would receive the other's window.
let captureQueue: Promise<void> = Promise.resolve()

function runSerialized<T>(task: () => Promise<T>): Promise<T> {
  const run = captureQueue.then(task, task)
  captureQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** Live video of one native window while the pane is visible; stopped when hidden or switched. */
export function useDesktopAppCapture(
  target: DesktopAppTarget | null,
  isActive: boolean
): DesktopAppCaptureState {
  const [state, setState] = useState<DesktopAppCaptureState>({ stream: null, error: null })
  const windowId = target?.windowId ?? null
  const pid = target?.pid ?? null

  useEffect(() => {
    const api = window.api?.desktopApp
    if (!isActive || windowId === null || pid === null || !api) {
      setState({ stream: null, error: null })
      return
    }
    let cancelled = false
    let stream: MediaStream | null = null
    const onTrackEnded = (): void => {
      if (!cancelled) {
        setState({
          stream: null,
          error: translate(
            'auto.components.desktop.app.pane.use.desktop.app.capture.006a3c21a6',
            'The window was closed or can no longer be captured.'
          )
        })
      }
    }
    const start = async (): Promise<void> => {
      try {
        // Main arms this window as the answer to our next getDisplayMedia; no system picker shows.
        const next = await runSerialized(async () => {
          if (cancelled) {
            return null
          }
          await api.prepareCapture({ windowId, pid })
          return navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 30, max: 60 } },
            audio: false
          })
        })
        if (!next) {
          return
        }
        if (cancelled) {
          next.getTracks().forEach((t) => t.stop())
          return
        }
        stream = next
        next.getVideoTracks()[0]?.addEventListener('ended', onTrackEnded)
        setState({ stream: next, error: null })
      } catch (err) {
        if (!cancelled) {
          setState({ stream: null, error: describeCaptureError(err) })
        }
      }
    }
    void start()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [isActive, windowId, pid])

  return state
}

function describeCaptureError(err: unknown): string {
  // Why: Chromium reports a macOS Screen Recording denial as a bare "Permission denied".
  if (err instanceof DOMException && err.name === 'NotAllowedError') {
    return translate(
      'auto.components.desktop.app.pane.use.desktop.app.capture.84bd9c534b',
      'macOS blocked the capture. Allow Orca in System Settings › Privacy & Security › Screen Recording, then reopen this tab.'
    )
  }
  return errorMessage(err)
}
