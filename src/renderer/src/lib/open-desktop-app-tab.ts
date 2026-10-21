import { translate } from '@/i18n/i18n'
import { createLiveSurfaceTabRightOf } from './ensure-simulator-tab'

/** Desktop app tabs show a local macOS window, so only the Electron client on a Mac offers them. */
export function canOpenDesktopAppTab(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.userAgent.includes('Mac') &&
    Boolean(window.api?.desktopApp)
  )
}

/** A new Desktop App tab beside the source group (to its right, reusing an existing right split). */
export function openDesktopAppTab(worktreeId: string, sourceGroupId: string): string | null {
  return createLiveSurfaceTabRightOf(
    worktreeId,
    sourceGroupId,
    'desktop-app',
    translate('auto.lib.open.desktop.app.tab.42cef4eb31', 'Desktop App')
  )
}
