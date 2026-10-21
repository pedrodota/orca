import { randomUUID } from 'node:crypto'
import type { ComputerActionResult } from '../../shared/runtime-types'
import type { DesktopAppAgentActivity, DesktopAppAgentBlock } from '../../shared/desktop-app-types'
import { parseDesktopAppSelector, selectorNamesApp } from '../../shared/desktop-app-selector'
import { isRecord } from './desktop-app-window-list'
import { RuntimeClientError } from '../computer/runtime-client-error'
import { COMPUTER_ERROR_CODES, type ComputerAppInfo } from '../../shared/computer-use-runtime-types'

// Why no Electron import: computer RPC methods are reachable from the plain-Node
// runtime graph, so the desktop shell installs the broadcaster as a listener.
type ActivityListener = (activity: DesktopAppAgentActivity) => void
// The running apps exactly as the native provider sees them when it resolves `--app`.
export type ListRunningApps = () => Promise<ComputerAppInfo[]>

let activityListener: ActivityListener | null = null
const blockedApps = new Map<number, DesktopAppAgentBlock>()

export function setDesktopAppActivityListener(listener: ActivityListener | null): void {
  activityListener = listener
}

export function blockDesktopAppAgent(block: DesktopAppAgentBlock): void {
  blockedApps.set(block.pid, block)
}

export function allowDesktopAppAgent(pid: number): void {
  blockedApps.delete(pid)
}

export function isDesktopAppAgentBlocked(pid: number): boolean {
  pruneExitedApps()
  return blockedApps.has(pid)
}

export function resetDesktopAppAgentControlForTest(): void {
  blockedApps.clear()
  activityListener = null
}

export function findBlockedDesktopApp(selector: string | null): DesktopAppAgentBlock | null {
  const parsed = parseDesktopAppSelector(selector)
  if (!parsed) {
    return null
  }
  pruneExitedApps()
  for (const block of blockedApps.values()) {
    if (parsed.kind === 'pid' ? block.pid === parsed.pid : selectorNamesApp(parsed.name, block)) {
      return block
    }
  }
  return null
}

/** The app this selector resolves to with the native provider's own rules (resolveApp in main.swift). */
export function resolveSelectorPid(selector: string, apps: ComputerAppInfo[]): number | null {
  const parsed = parseDesktopAppSelector(selector)
  if (!parsed || parsed.kind === 'pid') {
    return parsed?.pid ?? null
  }
  const app = apps.find((candidate) =>
    selectorNamesApp(parsed.name, { appName: candidate.name, bundleId: candidate.bundleId })
  )
  return app?.pid ?? null
}

// Why: a block names one running process. Once it exits, its pid can be handed to an unrelated
// app, which must not inherit the block, and the user has nothing left to allow again.
function pruneExitedApps(): void {
  for (const pid of blockedApps.keys()) {
    if (!isProcessAlive(pid)) {
      blockedApps.delete(pid)
    }
  }
}

function pruneReusedPids(apps: ComputerAppInfo[]): void {
  for (const app of apps) {
    const block = blockedApps.get(app.pid)
    if (block && !sameApp(block, app)) {
      blockedApps.delete(app.pid)
    }
  }
}

function sameApp(block: DesktopAppAgentBlock, app: ComputerAppInfo): boolean {
  return block.bundleId !== null && app.bundleId
    ? block.bundleId === app.bundleId
    : block.appName === app.name
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 only probes the process; it works the same on macOS, Linux and Windows.
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function findBlockedTarget(
  selector: string | null,
  listApps: ListRunningApps
): Promise<DesktopAppAgentBlock | null> {
  pruneExitedApps()
  if (!selector || blockedApps.size === 0) {
    return null
  }
  const apps = await listApps()
  pruneReusedPids(apps)
  // Why: the block must hold for every spelling the native provider accepts for that app, so the
  // final word is the pid the selector resolves to, not how this module reads the text.
  const pid = resolveSelectorPid(selector, apps)
  return findBlockedDesktopApp(selector) ?? (pid === null ? null : (blockedApps.get(pid) ?? null))
}

export async function runComputerActionWithActivity(
  method: string,
  params: unknown,
  run: () => Promise<ComputerActionResult>,
  listApps: ListRunningApps
): Promise<ComputerActionResult> {
  const record = isRecord(params) ? params : {}
  const appSelector = typeof record.app === 'string' ? record.app : null
  const blocked = await findBlockedTarget(appSelector, listApps)
  if (blocked) {
    throw new RuntimeClientError(
      COMPUTER_ERROR_CODES.desktop_app_stopped_by_user,
      `The user stopped agent control of ${blocked.appName} in Orca. Ask them to allow it again.`
    )
  }
  const activityId = randomUUID()
  const parsedSelector = parseDesktopAppSelector(appSelector)
  const startPid = parsedSelector?.kind === 'pid' ? parsedSelector.pid : null
  const base = { activityId, method, appSelector }
  emit({
    ...base,
    phase: 'start',
    pid: startPid,
    windowId: numberOrNull(record.windowId),
    point: pointFromParams(record),
    ok: null,
    at: Date.now()
  })
  try {
    const result = await run()
    emit({
      ...base,
      phase: 'end',
      pid: result.snapshot?.app?.pid ?? startPid,
      windowId:
        result.action?.targetWindowId ??
        result.snapshot?.window?.id ??
        numberOrNull(record.windowId),
      point: result.action?.targetPoint ?? pointFromParams(record),
      ok: true,
      at: Date.now()
    })
    return result
  } catch (error) {
    emit({
      ...base,
      phase: 'end',
      pid: startPid,
      windowId: numberOrNull(record.windowId),
      point: null,
      ok: false,
      at: Date.now()
    })
    throw error
  }
}

function emit(activity: DesktopAppAgentActivity): void {
  try {
    activityListener?.(activity)
  } catch (error) {
    // Why: an indicator failure must never fail the agent's action.
    console.warn('[desktop-app] activity listener failed:', error)
  }
}

function pointFromParams(record: Record<string, unknown>): { x: number; y: number } | null {
  const x = numberOrNull(record.x) ?? numberOrNull(record.fromX)
  const y = numberOrNull(record.y) ?? numberOrNull(record.fromY)
  return x !== null && y !== null ? { x, y } : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
