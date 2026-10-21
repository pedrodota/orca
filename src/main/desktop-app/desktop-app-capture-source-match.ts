// Electron names macOS window sources `window:<CGWindowID>:<n>`.
export function findWindowCaptureSource<T extends { id: string }>(
  sources: readonly T[],
  windowId: number
): T | null {
  const prefix = `window:${windowId}:`
  return sources.find((source) => source.id.startsWith(prefix)) ?? null
}

export function describeMissingCaptureSource(windowId: number, totalWindowSources: number): string {
  // Why: without Screen Recording, macOS hands Electron no window sources at all.
  if (totalWindowSources === 0) {
    return 'Orca cannot see any app windows. Allow Orca in System Settings › Privacy & Security › Screen Recording, then reopen this tab.'
  }
  return `Window ${windowId} is no longer open. Pick the app window again.`
}
