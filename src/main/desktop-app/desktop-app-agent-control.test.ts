import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComputerActionResult } from '../../shared/runtime-types'
import type { DesktopAppAgentActivity } from '../../shared/desktop-app-types'
import { COMPUTER_ERROR_CODES } from '../../shared/computer-use-runtime-types'
import {
  allowDesktopAppAgent,
  blockDesktopAppAgent,
  findBlockedDesktopApp,
  resetDesktopAppAgentControlForTest,
  runComputerActionWithActivity,
  setDesktopAppActivityListener
} from './desktop-app-agent-control'

const PEPPER = { pid: 4242, appName: 'PEPPER', bundleId: 'app.moovefy.pepper' }
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

afterEach(() => {
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
      RUNNING_APPS
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
        RUNNING_APPS
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
        RUNNING_APPS
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
        runComputerActionWithActivity('computer.click', { app }, run, RUNNING_APPS)
      ).rejects.toMatchObject({ code: COMPUTER_ERROR_CODES.desktop_app_stopped_by_user })
    }
    await expect(
      runComputerActionWithActivity('computer.click', { app: 'Safari' }, run, RUNNING_APPS)
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
        RUNNING_APPS
      )
    ).resolves.toMatchObject({ action: { path: 'accessibility' } })
    warn.mockRestore()
  })
})
