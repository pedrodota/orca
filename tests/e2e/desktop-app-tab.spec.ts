import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { runCompiledOrcaCli } from './helpers/compiled-orca-cli'

// Why: the pane shows a real macOS window, so this spec needs a Mac with Screen Recording and
// Accessibility granted and a running app to show, named by ORCA_E2E_DESKTOP_APP_TARGET
// (e.g. "TextEdit"). It never raises that app: agent actions here are scrolls posted to its pid.
const TARGET_APP = process.env.ORCA_E2E_DESKTOP_APP_TARGET ?? ''
const SHOT_DIR = process.env.ORCA_E2E_DESKTOP_APP_SHOT_DIR ?? ''
const PANE = '[data-desktop-app-pane]'
const OVERLAY = '[data-desktop-app-agent-overlay]'

async function openDesktopAppTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    if (!state || !worktreeId) {
      throw new Error('No active worktree')
    }
    const groupId =
      state.activeGroupIdByWorktree[worktreeId] ?? state.groupsByWorktree[worktreeId]?.[0]?.id
    const tab = state.createUnifiedTab(worktreeId, 'desktop-app', {
      label: 'Desktop App',
      targetGroupId: groupId,
      activate: true
    })
    state.activateTab(tab.id)
    state.setActiveTabType('desktop-app', worktreeId)
  })
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOT_DIR) {
    await page.locator(PANE).screenshot({ path: `${SHOT_DIR}/${name}.png` })
  }
}

test.describe('Desktop App tab', () => {
  test.skip(
    process.platform !== 'darwin' || TARGET_APP === '',
    'needs macOS and ORCA_E2E_DESKTOP_APP_TARGET'
  )

  test('shows a live Mac window and the agent-control indicator', async ({
    orcaPage,
    electronApp
  }) => {
    test.setTimeout(180_000)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const agentScroll = (x: number, y: number) =>
      runCompiledOrcaCli(userDataDir, [
        'computer',
        'scroll',
        '--app',
        TARGET_APP,
        '--x',
        String(x),
        '--y',
        String(y),
        '--direction',
        'down',
        '--pages',
        '0.1',
        '--no-screenshot',
        '--json'
      ])

    await openDesktopAppTab(orcaPage)
    const pane = orcaPage.locator(PANE).filter({ visible: true })
    await expect(pane).toBeVisible()
    await shot(orcaPage, '02-aba-escolher-janela')

    await pane.getByRole('button', { name: TARGET_APP }).first().click()
    await expect
      .poll(() => pane.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth), {
        timeout: 30_000
      })
      .toBeGreaterThan(0)
    await shot(orcaPage, '03-aba-janela-ao-vivo')

    const first = await agentScroll(200, 300)
    expect(first.json?.ok, first.stderr).toBe(true)
    await expect(pane.locator(OVERLAY)).toBeVisible()
    await expect(pane.getByText('Claude is controlling this app')).toBeVisible()
    await orcaPage.waitForTimeout(700)
    await shot(orcaPage, '04-agente-controlando')

    // The cursor glides to the next point instead of jumping there. Asserted on the transition it
    // runs, not on a mid-flight sample: a background E2E window paints no frames, so Chromium can
    // finish CSS transitions instantly there.
    const cursor = pane.locator('[data-desktop-app-agent-cursor]')
    const motion = () =>
      cursor.evaluate((el) => {
        const style = getComputedStyle(el)
        return {
          transform: style.transform,
          property: style.transitionProperty,
          durationMs: Number.parseFloat(style.transitionDuration) * 1000
        }
      })
    const before = await motion()
    await agentScroll(700, 600)
    await expect.poll(async () => (await motion()).transform).not.toBe(before.transform)
    await shot(orcaPage, '05-cursor-em-movimento')
    const after = await motion()
    expect(after.property).toContain('transform')
    expect(after.durationMs).toBeGreaterThanOrEqual(180)

    await pane.getByRole('button', { name: 'Stop Claude' }).click()
    await expect(pane.getByText('Claude was stopped for this app')).toBeVisible()
    await shot(orcaPage, '06-agente-parado')
    const refused = await agentScroll(300, 300)
    expect(refused.json?.ok).toBe(false)
    expect(refused.json?.error?.code).toBe('desktop_app_stopped_by_user')

    await pane.getByRole('button', { name: 'Allow again' }).click()
    await expect(pane.locator(OVERLAY)).toHaveCount(0)
    await shot(orcaPage, '07-sem-indicador')
  })
})
