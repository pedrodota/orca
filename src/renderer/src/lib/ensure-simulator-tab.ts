import { useAppStore } from '@/store'
import { findReusableRightSplitGroupId } from './emulator-right-split-target'
import { cancelPendingSimulatorPaneShutdown } from './simulator-pane-shutdown-scheduler'
import { shouldShutdownSimulatorForPaneUnmountFromTabs } from './simulator-tab-shutdown'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from './browser-uuid'
import type { LiveSurfaceContentType } from '../../../shared/tab-types'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../shared/execution-host'
import {
  findAmbiguousWorktreeIds,
  getActiveExecutionHostIdForWorktree,
  isUnifiedTabOwnedByWorktree
} from './unified-tab-host-ownership'
import { isExecutionHostAliasForWorktree } from './worktree-execution-host-alias'
import { folderWorkspaceToWorktree } from '../../../shared/folder-workspace-worktree'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../shared/layout-owner-switch'
import { recordOpenedSimulatorTabInLayoutOwner } from './simulator-tab-layout-owner'
import { selectFolderWorkspaces } from '@/store/workspace-record-selectors'

type EnsureSimulatorTabOptions = {
  targetGroupId?: string
  placement?: 'activeGroup' | 'rightSplit'
  /** When true, activate the tab and focus the owning group (default true). */
  surfacePane?: boolean
  executionHostId?: ExecutionHostId
}

type ExistingSimulatorTab = {
  id: string
  groupId: string
  contentType: string
}

function getSimulatorWorktrees(state: ReturnType<typeof useAppStore.getState>, worktreeId: string) {
  return [
    ...(state.allWorktrees?.() ?? []),
    ...(selectFolderWorkspaces(state) ?? []).map(folderWorkspaceToWorktree)
  ].filter((worktree) => worktree.id === worktreeId)
}

function resolveSimulatorExecutionHostId(
  state: ReturnType<typeof useAppStore.getState>,
  worktreeId: string,
  requestedHostId?: ExecutionHostId
): ExecutionHostId | undefined {
  const worktrees = getSimulatorWorktrees(state, worktreeId)
  const preferredHostId = requestedHostId ?? getActiveExecutionHostIdForWorktree(state, worktreeId)
  if (
    preferredHostId &&
    worktrees.some((worktree) => isExecutionHostAliasForWorktree(preferredHostId, worktree))
  ) {
    return preferredHostId
  }
  if (requestedHostId) {
    return requestedHostId
  }
  return worktrees.length === 1 ? (worktrees[0].hostId ?? LOCAL_EXECUTION_HOST_ID) : requestedHostId
}

export function getSimulatorTabForWorktree(
  worktreeId: string,
  executionHostId?: ExecutionHostId
): ExistingSimulatorTab | null {
  const state = useAppStore.getState()
  const worktrees = getSimulatorWorktrees(state, worktreeId)
  const activeExecutionHostId =
    executionHostId ?? getActiveExecutionHostIdForWorktree(state, worktreeId)
  const activeWorktree = worktrees.find((worktree) =>
    activeExecutionHostId ? isExecutionHostAliasForWorktree(activeExecutionHostId, worktree) : false
  )
  const simulatorTabs = (state.unifiedTabsByWorktree[worktreeId] ?? []).filter(
    (tab) => tab.contentType === 'simulator'
  )
  if (worktrees.length === 0) {
    if (executionHostId) {
      return simulatorTabs.find((tab) => tab.executionHostId === executionHostId) ?? null
    }
    return simulatorTabs[0] ?? null
  }
  if (executionHostId && !activeWorktree) {
    return simulatorTabs.find((tab) => tab.executionHostId === executionHostId) ?? null
  }
  const target = activeWorktree ?? (worktrees.length === 1 ? worktrees[0] : null)
  if (!target) {
    return null
  }
  const ambiguousWorktreeIds = findAmbiguousWorktreeIds(worktrees)
  return (
    simulatorTabs.find((tab) => isUnifiedTabOwnedByWorktree(tab, target, ambiguousWorktreeIds)) ??
    null
  )
}

/** One simulator tab per worktree; focuses existing tab instead of creating duplicates. */
export function ensureSimulatorTab(
  worktreeId: string,
  options?: EnsureSimulatorTabOptions
): string | null {
  const store = useAppStore.getState()
  if (store.settings?.mobileEmulatorEnabled === false) {
    return null
  }
  const sourceGroupId =
    options?.targetGroupId ??
    store.activeGroupIdByWorktree[worktreeId] ??
    store.groupsByWorktree[worktreeId]?.[0]?.id
  if (!sourceGroupId) {
    return null
  }
  cancelPendingSimulatorPaneShutdown(worktreeId)

  const executionHostId = resolveSimulatorExecutionHostId(
    store,
    worktreeId,
    options?.executionHostId
  )
  const existing = getSimulatorTabForWorktree(worktreeId, executionHostId)
  const shouldSurface = options?.surfacePane ?? true
  if (existing) {
    if (shouldSurface && store.activeWorktreeId === worktreeId) {
      store.activateTab(existing.id)
      store.focusGroup(worktreeId, existing.groupId)
      store.setActiveTabType('simulator', worktreeId)
    }
    return existing.id
  }

  if (options?.placement === 'rightSplit' && shouldSurface) {
    return createLiveSurfaceTabRightOf(
      worktreeId,
      sourceGroupId,
      'simulator',
      translate('auto.lib.ensure.simulator.tab.372d21d428', 'Mobile Emulator'),
      executionHostId
    )
  }

  const tabId = createBrowserUuid()
  store.createUnifiedTab(worktreeId, 'simulator', {
    id: tabId,
    label: translate('auto.lib.ensure.simulator.tab.372d21d428', 'Mobile Emulator'),
    targetGroupId: sourceGroupId,
    activate: shouldSurface,
    ...(executionHostId ? { executionHostId } : {})
  })
  recordOpenedLiveSurfaceTab(tabId)
  if (shouldSurface) {
    surfaceCreatedLiveSurfaceTab(worktreeId, tabId, 'simulator')
  }
  return tabId
}

/**
 * Creates a live-surface tab beside the source group, to its right: reuses an existing right
 * split, else splits. Falls back to the source group itself if the split cannot be created.
 */
export function createLiveSurfaceTabRightOf(
  worktreeId: string,
  sourceGroupId: string,
  contentType: LiveSurfaceContentType,
  label: string,
  executionHostId?: ExecutionHostId
): string | null {
  const store = useAppStore.getState()
  const tabOptions = { label, activate: true, ...(executionHostId ? { executionHostId } : {}) }
  const reusableRightGroupId = findReusableRightSplitGroupId(
    store.layoutByWorktree[worktreeId],
    sourceGroupId
  )
  let tabId: string | null = null
  // Why: a tab published straight into a new split is already active there, so only the other
  // paths need the explicit surfacing step (keeps the pre-existing simulator behavior).
  let needsSurfacing = true
  if (reusableRightGroupId) {
    tabId = createBrowserUuid()
    store.createUnifiedTab(worktreeId, contentType, {
      ...tabOptions,
      id: tabId,
      targetGroupId: reusableRightGroupId
    })
  } else {
    // Why: publish the tab directly in its split group. A two-step
    // create-then-move can persist the midpoint during dev reload/HMR.
    tabId =
      store.createUnifiedTabInSplit(
        worktreeId,
        contentType,
        { sourceGroupId, splitDirection: 'right' },
        tabOptions
      )?.id ?? null
    needsSurfacing = tabId === null
  }
  if (!tabId) {
    tabId = createBrowserUuid()
    store.createUnifiedTab(worktreeId, contentType, {
      ...tabOptions,
      id: tabId,
      targetGroupId: sourceGroupId
    })
  }
  recordOpenedLiveSurfaceTab(tabId)
  if (needsSurfacing) {
    surfaceCreatedLiveSurfaceTab(worktreeId, tabId, contentType)
  }
  return tabId
}

/** Switch point: main records the live-surface tab the window just drew. */
function recordOpenedLiveSurfaceTab(tabId: string): void {
  if (!ORCA_LAYOUT_OWNER_IS_MAIN) {
    return
  }
  const state = useAppStore.getState()
  const tab = state.getTab(tabId)
  if (tab) {
    recordOpenedSimulatorTabInLayoutOwner(state, tab)
  }
}

function surfaceCreatedLiveSurfaceTab(
  worktreeId: string,
  tabId: string,
  contentType: LiveSurfaceContentType
): void {
  const store = useAppStore.getState()
  store.activateTab(tabId)
  store.setActiveTabType(contentType, worktreeId)
  // Why read by id: placement falls back to the active group when the requested one is gone.
  const groupId = store.getTab(tabId)?.groupId
  if (groupId) {
    store.focusGroup(worktreeId, groupId)
  }
}

export { shouldShutdownSimulatorForPaneUnmountFromTabs }
