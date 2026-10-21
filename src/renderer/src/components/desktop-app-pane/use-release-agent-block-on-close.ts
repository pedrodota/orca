import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { Tab } from '../../../../shared/tab-types'
import { readRememberedTarget } from './desktop-app-target-memory'

/** Whether closing this tab leaves no other Desktop App tab showing the app with this pid. */
export function shouldReleaseAgentBlock(
  closedTabId: string,
  pid: number,
  openTabs: readonly Pick<Tab, 'id' | 'contentType'>[],
  rememberedPid: (tabId: string) => number | null
): boolean {
  const desktopTabs = openTabs.filter((tab) => tab.contentType === 'desktop-app')
  if (desktopTabs.some((tab) => tab.id === closedTabId)) {
    // Still open: the pane only remounted (split, move, workspace switch).
    return false
  }
  return !desktopTabs.some((tab) => rememberedPid(tab.id) === pid)
}

// Why: a stop is the user's call about this pane; once the tab is gone nothing can show
// "Allow again", so the block would silently outlive every way to lift it.
export function useReleaseAgentBlockOnClose(tabId: string, pid: number | null): void {
  useEffect(() => {
    if (pid === null) {
      return
    }
    return () => {
      // Why: deferred so a remount (same tab id) is already back in the store when we look.
      setTimeout(() => {
        const tabs = Object.values(useAppStore.getState().unifiedTabsByWorktree).flat()
        const rememberedPid = (id: string): number | null => readRememberedTarget(id)?.pid ?? null
        if (shouldReleaseAgentBlock(tabId, pid, tabs, rememberedPid)) {
          void window.api?.desktopApp?.allowAgent({ pid })
        }
      }, 0)
    }
  }, [tabId, pid])
}
