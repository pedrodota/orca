import { randomUUID } from 'node:crypto'
import type { ComputerActionResult } from '../../shared/runtime-types'
import type { DesktopAppAgentActivity, DesktopAppAgentBlock } from '../../shared/desktop-app-types'
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
  return blockedApps.has(pid)
}

export function resetDesktopAppAgentControlForTest(): void {
  blockedApps.clear()
  activityListener = null
}

export function findBlockedDesktopApp(selector: string | null): DesktopAppAgentBlock | null {
  if (!selector) {
    return null
  }
  const trimmed = trimLikeNative(selector)
  const pid = parsePidSelector(trimmed)
  for (const block of blockedApps.values()) {
    if (pid !== null ? block.pid === pid : matchesAppName(block, trimmed)) {
      return block
    }
  }
  return null
}

/** The app this selector resolves to with the native provider's own rules (resolveApp in main.swift). */
export function resolveSelectorPid(selector: string, apps: ComputerAppInfo[]): number | null {
  const trimmed = trimLikeNative(selector)
  const pid = parsePidSelector(trimmed)
  if (pid !== null) {
    return pid
  }
  const app = apps.find(
    (candidate) => sameName(candidate.name, trimmed) || sameName(candidate.bundleId, trimmed)
  )
  return app?.pid ?? null
}

async function findBlockedTarget(
  selector: string | null,
  listApps: ListRunningApps
): Promise<DesktopAppAgentBlock | null> {
  if (!selector || blockedApps.size === 0) {
    return null
  }
  const direct = findBlockedDesktopApp(selector)
  if (direct) {
    return direct
  }
  // Why: the block must hold for every spelling the native provider accepts for that app, so the
  // final word is the pid the selector resolves to, not how this module reads the text.
  const pid = resolveSelectorPid(selector, await listApps())
  return pid === null ? null : (blockedApps.get(pid) ?? null)
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
  const startPid = appSelector ? parsePidSelector(trimLikeNative(appSelector)) : null
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

function matchesAppName(block: DesktopAppAgentBlock, selector: string): boolean {
  return sameName(block.appName, selector) || sameName(block.bundleId, selector)
}

// Why: String.trim() misses U+0085, which Swift's `.whitespacesAndNewlines` strips, so a selector
// like "\u0085pid:5" would otherwise read as an unknown app here and as pid 5 in the helper.
const NATIVE_WHITESPACE_EDGES = /^[\p{Z}\t-\r\u0085]+|[\p{Z}\t-\r\u0085]+$/gu

function trimLikeNative(selector: string): string {
  return selector.replace(NATIVE_WHITESPACE_EDGES, '')
}

// Case-insensitive, accent-sensitive, like `caseInsensitiveCompare` in main.swift. Fixed 'und'
// locale so the match never depends on the user's system language.
function sameName(name: string | null | undefined, selector: string): boolean {
  return name != null && name.localeCompare(selector, 'und', { sensitivity: 'accent' }) === 0
}

// Same grammar as parsePid in main.swift: lowercase prefix, then an Int32 (optional sign) above 0.
function parsePidSelector(selector: string): number | null {
  const match = /^pid:([+-]?\d+)$/.exec(selector)
  const pid = match ? Number(match[1]) : Number.NaN
  return Number.isInteger(pid) && pid > 0 && pid <= 2_147_483_647 ? pid : null
}

function pointFromParams(record: Record<string, unknown>): { x: number; y: number } | null {
  const x = numberOrNull(record.x) ?? numberOrNull(record.fromX)
  const y = numberOrNull(record.y) ?? numberOrNull(record.fromY)
  return x !== null && y !== null ? { x, y } : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
