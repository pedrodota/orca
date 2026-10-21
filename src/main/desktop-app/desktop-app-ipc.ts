import { BrowserWindow, ipcMain } from 'electron'
import type {
  DesktopAppAgentActivity,
  DesktopAppInputResult,
  DesktopAppWindow
} from '../../shared/desktop-app-types'
import { callComputerSidecarDesktopApp } from '../computer/sidecar-client'
import {
  allowDesktopAppAgent,
  blockDesktopAppAgent,
  isDesktopAppAgentBlocked,
  setDesktopAppActivityListener
} from './desktop-app-agent-control'
import { isTrustedUIRenderer } from '../ipc/ui'
import {
  isDesktopAppWindowAuthorized,
  prepareDesktopAppCapture
} from './desktop-app-capture-source'
import {
  parseAgentBlockArgs,
  parsePidArgs,
  parseSendInputArgs,
  parseTargetArgs
} from './desktop-app-ipc-schema'
import { parseDesktopAppWindows } from './desktop-app-window-list'

function broadcastAgentActivity(activity: DesktopAppAgentActivity): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }
    try {
      window.webContents.send('desktopApp:agentActivity', activity)
    } catch {
      // A renderer can disappear between isDestroyed() and send().
    }
  }
}

export function registerDesktopAppHandlers(): void {
  setDesktopAppActivityListener(broadcastAgentActivity)
  ipcMain.handle('desktopApp:listWindows', async (event): Promise<DesktopAppWindow[]> => {
    assertTrustedSender(event.sender)
    return parseDesktopAppWindows(await callComputerSidecarDesktopApp('listDesktopWindows', {}))
  })
  ipcMain.handle('desktopApp:prepareCapture', (event, args: unknown) => {
    assertTrustedSender(event.sender)
    const target = parseTargetArgs(args, 'desktopApp:prepareCapture')
    return prepareDesktopAppCapture(event.sender, target)
  })
  ipcMain.handle(
    'desktopApp:sendInput',
    async (event, args: unknown): Promise<DesktopAppInputResult> => {
      assertTrustedSender(event.sender)
      const { pid, windowId, input } = parseSendInputArgs(args, 'desktopApp:sendInput')
      // Why: input may only go to a window this renderer armed for capture, i.e. the one the
      // user picked in the pane, never an arbitrary app such as Terminal.
      if (!isDesktopAppWindowAuthorized(event.sender.id, { pid, windowId })) {
        throw new Error('desktopApp:sendInput: window was not chosen in this Desktop App tab')
      }
      const result = await callComputerSidecarDesktopApp('desktopInput', { pid, windowId, input })
      const path =
        result && typeof result === 'object' && 'path' in result ? result.path : undefined
      return { path: path === 'accessibility' ? 'accessibility' : 'synthetic' }
    }
  )
  ipcMain.handle('desktopApp:stopAgent', (event, args: unknown) => {
    assertTrustedSender(event.sender)
    blockDesktopAppAgent(parseAgentBlockArgs(args, 'desktopApp:stopAgent'))
  })
  ipcMain.handle('desktopApp:allowAgent', (event, args: unknown) => {
    assertTrustedSender(event.sender)
    allowDesktopAppAgent(parsePidArgs(args, 'desktopApp:allowAgent').pid)
  })
  ipcMain.handle('desktopApp:isAgentBlocked', (event, args: unknown) => {
    assertTrustedSender(event.sender)
    return isDesktopAppAgentBlocked(parsePidArgs(args, 'desktopApp:isAgentBlocked').pid)
  })
}

function assertTrustedSender(sender: Electron.WebContents): void {
  if (!isTrustedUIRenderer(sender)) {
    throw new Error('desktopApp: untrusted sender')
  }
}
