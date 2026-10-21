import type {
  DesktopAppCaptureSource,
  DesktopAppInput,
  DesktopAppInputResult,
  DesktopAppTarget,
  DesktopAppWindow
} from '../../shared/desktop-app-types'

export type DesktopAppApi = {
  listWindows: () => Promise<DesktopAppWindow[]>
  // Arms the window as the source for the caller's next navigator.mediaDevices.getDisplayMedia().
  prepareCapture: (args: DesktopAppTarget) => Promise<DesktopAppCaptureSource>
  sendInput: (args: DesktopAppTarget & { input: DesktopAppInput }) => Promise<DesktopAppInputResult>
}
