import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputerActionResult } from '../../shared/runtime-types'
import type { DesktopAppAgentActivity } from '../../shared/desktop-app-types'
import { COMPUTER_ERROR_CODES } from '../../shared/computer-use-runtime-types'
import { processStartIdentity } from './desktop-app-process-identity'
import {
  allowDesktopAppAgent,
  blockDesktopAppAgent,
  findBlockedDesktopApp,
  isDesktopAppAgentBlocked,
  resetDesktopAppAgentControlForTest,
  runComputerActionWithActivity,
  setDesktopAppActivityListener
} from './desktop-app-agent-control'

const PEPPER = { pid: 4242, appName: 'PEPPER', bundleId: 'app.moovefy.pepper' }
const NO_PROVIDER_PID = async (): Promise<number | null> => null
const RUNNING_APPS = async () => [
  { name: 'PEPPER', bundleId: PEPPER.bundleId, pid: PEPPER.pid },
  { name: 'Safari', bundleId: 'com.apple.Safari', pid: 7 }
]

function actionResult(
  overrides: Partial<ComputerActionResult['action']> = {}
): ComputerActionResult {
  return {
    snapshot: {
      id: 's1',
      app: { name: 'PEPPER', bundleId: PEPPER.bundleId, pid: PEPPER.pid },
      window: { id: 77, title: 'PEPPER', width: 1280, height: 1016 },
      coordinateSpace: 'window',
      treeText: '',
      elementCount: 0,
      focusedElementId: null
    },
    screenshot: null,
    screenshotStatus: { state: 'skipped', reason: 'no_screenshot_flag' },
    action: { path: 'accessibility', targetPoint: { x: 68, y: 235 }, ...overrides }
  }
}

vi.mock('./desktop-app-process-identity', () => ({ processStartIdentity: vi.fn(() => null) }))

const exitedPids = new Set<number>()

beforeEach(() => {
  vi.spyOn(process, 'kill').mockImplementation((pid: number) => {
    if (exitedPids.has(pid)) {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
    }
    return true
  })
})

afterEach(() => {
  exitedPids.clear()
  vi.restoreAllMocks()
  resetDesktopAppAgentControlForTest()
})

describe('findBlockedDesktopApp', () => {
  it('matches pid selectors, app names and bundle ids case-insensitively', () => {
    blockDesktopAppAgent(PEPPER)
    expect(findBlockedDesktopApp('pid:4242')).toEqual(PEPPER)
    expect(findBlockedDesktopApp('pepper')).toEqual(PEPPER)
    expect(findBlockedDesktopApp(' APP.MOOVEFY.PEPPER ')).toEqual(PEPPER)
    expect(findBlockedDesktopApp('pid:1')).toBeNull()
    expect(findBlockedDesktopApp('Safari')).toBeNull()
    expect(findBlockedDesktopApp(null)).toBeNull()
  })

  it('trims the same edge characters as the native helper, including U+0085', () => {
    blockDesktopAppAgent(PEPPER)
    expect(findBlockedDesktopApp('\u0085pid:4242\u2028')).toEqual(PEPPER)
    expect(findBlockedDesktopApp('\u00a0PEPPER\t')).toEqual(PEPPER)
  })

  it('forgets the block once the app exits, so a reused pid is not blocked', () => {
    blockDesktopAppAgent(PEPPER)
    exitedPids.add(PEPPER.pid)
    expect(findBlockedDesktopApp('PEPPER')).toBeNull()
    exitedPids.clear()
    expect(isDesktopAppAgentBlocked(PEPPER.pid)).toBe(false)
  })

  it('stops matching once the app is allowed again', () => {
    blockDesktopAppAgent(PEPPER)
    allowDesktopAppAgent(PEPPER.pid)
    expect(findBlockedDesktopApp('PEPPER')).toBeNull()
  })
})

describe('runComputerActionWithActivity', () => {
  it('broadcasts start with the requested point and end with the landed point', async () => {
    const activities: DesktopAppAgentActivity[] = []
    setDesktopAppActivityListener((activity) => activities.push(activity))

    const result = await runComputerActionWithActivity(
      'computer.click',
      { app: 'PEPPER', x: 10, y: 20, windowId: 77 },
      async () => actionResult(),
      RUNNING_APPS,
      NO_PROVIDER_PID
    )

    expect(result.action?.targetPoint).toEqual({ x: 68, y: 235 })
    expect(activities.map((activity) => activity.phase)).toEqual(['start', 'end'])
    expect(activities[0]).toMatchObject({
      method: 'computer.click',
      appSelector: 'PEPPER',
      pid: null,
      windowId: 77,
      point: { x: 10, y: 20 },
      ok: null
    })
    expect(activities[1]).toMatchObject({
      activityId: activities[0].activityId,
      pid: PEPPER.pid,
      windowId: 77,
      point: { x: 68, y: 235 },
      ok: true
    })
  })

  it('uses the drag start as the start point and reports failures', async () => {
    const activities: DesktopAppAgentActivity[] = []
    setDesktopAppActivityListener((activity) => activities.push(activity))

    await expect(
      runComputerActionWithActivity(
        'computer.drag',
        { app: 'pid:4242', fromX: 1, fromY: 2, toX: 3, toY: 4 },
        async () => {
          throw new Error('boom')
        },
        RUNNING_APPS,
        NO_PROVIDER_PID
      )
    ).rejects.toThrow('boom')

    expect(activities[0]).toMatchObject({ pid: 4242, point: { x: 1, y: 2 } })
    expect(activities[1]).toMatchObject({ phase: 'end', ok: false, pid: 4242 })
  })

  it('rejects actions on a stopped app without running or broadcasting them', async () => {
    const listener = vi.fn()
    const run = vi.fn(async () => actionResult())
    setDesktopAppActivityListener(listener)
    blockDesktopAppAgent(PEPPER)

    await expect(
      runComputerActionWithActivity(
        'computer.typeText',
        { app: 'PEPPER', text: 'x' },
        run,
        RUNNING_APPS,
        NO_PROVIDER_PID
      )
    ).rejects.toMatchObject({
      code: COMPUTER_ERROR_CODES.desktop_app_stopped_by_user,
      message: 'The user stopped agent control of PEPPER in Orca. Ask them to allow it again.'
    })
    expect(run).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })

  it('blocks every selector spelling the native provider resolves to the stopped app', async () => {
    blockDesktopAppAgent(PEPPER)
    const run = vi.fn(async () => actionResult())

    for (const app of ['pid:+4242', 'pid:04242', 'App.Moovefy.Pepper']) {
      await expect(
        runComputerActionWithActivity('computer.click', { app }, run, RUNNING_APPS, NO_PROVIDER_PID)
      ).rejects.toMatchObject({ code: COMPUTER_ERROR_CODES.desktop_app_stopped_by_user })
    }
    await expect(
      runComputerActionWithActivity(
        'computer.click',
        { app: 'Safari' },
        run,
        RUNNING_APPS,
        NO_PROVIDER_PID
      )
    ).resolves.toBeDefined()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('keeps the action result when the listener throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setDesktopAppActivityListener(() => {
      throw new Error('renderer gone')
    })

    await expect(
      runComputerActionWithActivity(
        'computer.click',
        { app: 'PEPPER' },
        async () => actionResult(),
        RUNNING_APPS,
        NO_PROVIDER_PID
      )
    ).resolves.toMatchObject({ action: { path: 'accessibility' } })
    warn.mockRestore()
  })

  it('drops a block whose pid now belongs to another app', async () => {
    blockDesktopAppAgent(PEPPER)
    const run = vi.fn(async () => actionResult())
    const reused = async () => [
      { name: 'Terminal', bundleId: 'com.apple.Terminal', pid: PEPPER.pid }
    ]

    await expect(
      runComputerActionWithActivity(
        'computer.click',
        { app: 'pid:4242' },
        run,
        reused,
        NO_PROVIDER_PID
      )
    ).resolves.toBeDefined()
    expect(isDesktopAppAgentBlocked(PEPPER.pid)).toBe(false)
  })

  it('blocks spellings only the provider resolves (Windows and Linux selector grammars)', async () => {
    const notepad = { pid: 4321, appName: 'notepad', bundleId: 'notepad' }
    blockDesktopAppAgent(notepad)
    const run = vi.fn(async () => actionResult())
    const providerPid = async (selector: string) => (selector === 'Safari' ? 7 : notepad.pid)

    for (const app of ['notepad.exe', 'PID:4321', '4321', 'Untitled']) {
      await expect(
        runComputerActionWithActivity('computer.click', { app }, run, RUNNING_APPS, providerPid)
      ).rejects.toMatchObject({ code: COMPUTER_ERROR_CODES.desktop_app_stopped_by_user })
    }
    await expect(
      runComputerActionWithActivity(
        'computer.click',
        { app: 'Safari' },
        run,
        RUNNING_APPS,
        providerPid
      )
    ).resolves.toBeDefined()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('keeps a live block whose names differ between providers, and drops it once the pid is reused', async () => {
    const identity = vi.mocked(processStartIdentity)
    identity.mockReturnValue('1000')
    // X11 WM_CLASS names in the pane; AT-SPI names in listApps, for the same live process.
    const firefox = { pid: 900, appName: 'firefox', bundleId: 'Navigator' }
    blockDesktopAppAgent(firefox)
    const run = vi.fn(async () => actionResult())
    const atspi = async () => [{ name: 'Firefox', bundleId: 'Firefox', pid: firefox.pid }]

    await expect(
      runComputerActionWithActivity(
        'computer.click',
        { app: 'pid:900' },
        run,
        atspi,
        NO_PROVIDER_PID
      )
    ).rejects.toMatchObject({ code: COMPUTER_ERROR_CODES.desktop_app_stopped_by_user })
    expect(run).not.toHaveBeenCalled()

    identity.mockReturnValue('2000')
    await expect(
      runComputerActionWithActivity(
        'computer.click',
        { app: 'pid:900' },
        run,
        atspi,
        NO_PROVIDER_PID
      )
    ).resolves.toBeDefined()
    expect(isDesktopAppAgentBlocked(firefox.pid)).toBe(false)
  })

  it('keeps a block when the process identity cannot be read again', async () => {
    const identity = vi.mocked(processStartIdentity)
    identity.mockReturnValue('1000')
    blockDesktopAppAgent(PEPPER)
    identity.mockReturnValue(null)
    const run = vi.fn(async () => actionResult())

    await expect(
      runComputerActionWithActivity(
        'computer.click',
        { app: 'pid:4242' },
        run,
        RUNNING_APPS,
        NO_PROVIDER_PID
      )
    ).rejects.toMatchObject({ code: COMPUTER_ERROR_CODES.desktop_app_stopped_by_user })
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the action against the pid that passed the block check', async () => {
    blockDesktopAppAgent(PEPPER)
    const run = vi.fn(async (_params: unknown) => actionResult())

    await runComputerActionWithActivity(
      'computer.click',
      { app: 'Safari', x: 1, y: 2 },
      run,
      RUNNING_APPS,
      async () => 7
    )
    expect(run).toHaveBeenCalledWith({ app: 'pid:7', x: 1, y: 2 })
  })

  it('fails closed when a stop is active and the selector cannot be resolved', async () => {
    blockDesktopAppAgent(PEPPER)
    const run = vi.fn(async () => actionResult())
    const providerError = new Error('provider down')

    await expect(
      runComputerActionWithActivity(
        'computer.click',
        { app: 'Untitled' },
        run,
        RUNNING_APPS,
        async () => {
          throw providerError
        }
      )
    ).rejects.toBe(providerError)
    await expect(
      runComputerActionWithActivity(
        'computer.click',
        { app: 'Untitled' },
        run,
        RUNNING_APPS,
        NO_PROVIDER_PID
      )
    ).rejects.toMatchObject({ code: COMPUTER_ERROR_CODES.app_not_found })
    expect(run).not.toHaveBeenCalled()
  })

  it('passes params through untouched when no stop is active', async () => {
    const run = vi.fn(async (_params: unknown) => actionResult())
    const params = { app: 'Safari' }

    await runComputerActionWithActivity(
      'computer.click',
      params,
      run,
      RUNNING_APPS,
      NO_PROVIDER_PID
    )
    expect(run).toHaveBeenCalledWith(params)
  })
})
