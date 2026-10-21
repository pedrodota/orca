import { desktopCapturer, webContents, type DesktopCapturerSource, type Session } from 'electron'
import type { DesktopAppCaptureSource, DesktopAppTarget } from '../../shared/desktop-app-types'
import {
  describeMissingCaptureSource,
  findWindowCaptureSource
} from './desktop-app-capture-source-match'

// One armed source per renderer: prepareCapture arms it, the next getDisplayMedia consumes it.
const armedSources = new Map<number, { source: DesktopCapturerSource; armedAt: number }>()
// Windows each renderer armed, i.e. chose in its pane. Input is only accepted for these.
const authorizedWindows = new Map<number, Set<string>>()
// Why: a prepare whose getDisplayMedia never came must not keep granting capture.
const ARMED_SOURCE_TTL_MS = 10_000
const sessionsWithHandler = new WeakSet<Session>()

/** Arms `target` (already checked against the native window list) for the sender's next getDisplayMedia. */
export async function prepareDesktopAppCapture(
  sender: Electron.WebContents,
  { windowId, pid }: DesktopAppTarget
): Promise<DesktopAppCaptureSource> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 }
  })
  const source = findWindowCaptureSource(sources, windowId)
  if (!source) {
    throw new Error(describeMissingCaptureSource(windowId, sources.length))
  }
  installDisplayMediaHandler(sender.session)
  armedSources.set(sender.id, { source, armedAt: Date.now() })
  rememberAuthorizedWindow(sender, windowKey({ pid, windowId }))
  return { sourceId: source.id }
}

/** True while this renderer has a Desktop App window armed for its next getDisplayMedia. */
export function hasArmedDesktopAppCapture(webContentsId: number): boolean {
  return takeFreshArmed(webContentsId, false) !== undefined
}

export function isDesktopAppWindowAuthorized(
  webContentsId: number,
  target: DesktopAppTarget
): boolean {
  return authorizedWindows.get(webContentsId)?.has(windowKey(target)) ?? false
}

function windowKey({ pid, windowId }: DesktopAppTarget): string {
  return `${pid}:${windowId}`
}

function rememberAuthorizedWindow(sender: Electron.WebContents, key: string): void {
  let keys = authorizedWindows.get(sender.id)
  if (!keys) {
    keys = new Set()
    authorizedWindows.set(sender.id, keys)
    // Why: registered once per renderer, so repeated prepares do not stack listeners.
    sender.once('destroyed', () => {
      authorizedWindows.delete(sender.id)
      armedSources.delete(sender.id)
    })
  }
  keys.add(key)
}

function takeFreshArmed(
  webContentsId: number,
  consume: boolean
): DesktopCapturerSource | undefined {
  const armed = armedSources.get(webContentsId)
  if (!armed) {
    return undefined
  }
  if (Date.now() - armed.armedAt > ARMED_SOURCE_TTL_MS) {
    armedSources.delete(webContentsId)
    return undefined
  }
  if (consume) {
    armedSources.delete(webContentsId)
  }
  return armed.source
}

function installDisplayMediaHandler(session: Session): void {
  if (sessionsWithHandler.has(session)) {
    return
  }
  sessionsWithHandler.add(session)
  session.setDisplayMediaRequestHandler((request, callback) => {
    const requester = request.frame ? webContents.fromFrame(request.frame) : undefined
    const source = requester ? takeFreshArmed(requester.id, request.videoRequested) : undefined
    if (!requester || !source || !request.videoRequested) {
      // Why: only an armed Desktop App pane may capture; everything else is denied.
      callback({})
      return
    }
    callback({ video: source })
  })
}
