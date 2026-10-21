import type { NativeDesktopAppMethod } from './macos-native-provider-contract'
import type { BridgeRequest, BridgeResponse } from './desktop-script-provider-types'
import { RuntimeClientError } from './runtime-client-error'

type CallBridge = (request: BridgeRequest) => Promise<BridgeResponse>

/**
 * Desktop App pane calls on the Windows/Linux script runtimes. Same result shape as the macOS
 * helper: `{ windows }` for the list and `{ path }` for input.
 */
export async function callDesktopScriptDesktopApp(
  callBridge: CallBridge,
  method: NativeDesktopAppMethod,
  params: unknown,
  orcaPid: number = process.ppid
): Promise<unknown> {
  const record = params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
  if (method === 'listDesktopWindows') {
    // Why: the sidecar is forked by Orca main, so its parent pid owns Orca's own windows,
    // which must never be offered as a target (the pane would capture itself).
    const response = await callBridge({ tool: 'list_desktop_windows', excludePid: orcaPid })
    return { windows: Array.isArray(response.desktopWindows) ? response.desktopWindows : [] }
  }
  const pid = positiveInteger(record.pid, 'pid')
  const windowId = positiveInteger(record.windowId, 'windowId')
  if (!record.input || typeof record.input !== 'object') {
    throw new RuntimeClientError('invalid_argument', 'input is required')
  }
  const response = await callBridge({
    tool: 'desktop_input',
    pid,
    windowId,
    input: record.input as Record<string, unknown>
  })
  return { path: response.path === 'accessibility' ? 'accessibility' : 'synthetic' }
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new RuntimeClientError('invalid_argument', `${name} must be a positive integer`)
  }
  return value
}
