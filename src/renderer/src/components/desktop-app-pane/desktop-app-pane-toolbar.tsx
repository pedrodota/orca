import { AppWindow, RefreshCw } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DesktopAppWindow } from '../../../../shared/desktop-app-types'
import { translate } from '@/i18n/i18n'

type DesktopAppPaneToolbarProps = {
  windows: DesktopAppWindow[]
  selected: DesktopAppWindow | null
  // Null hides the badge: no window picked, or capture failed and the error banner explains why.
  captureStatus: 'live' | 'connecting' | null
  loading: boolean
  onSelectWindow: (windowId: number) => void
  onRefresh: () => void
}

export function windowLabel(window: DesktopAppWindow): string {
  return window.title && window.title !== window.appName
    ? `${window.appName} — ${window.title}`
    : window.appName
}

export function DesktopAppPaneToolbar({
  windows,
  selected,
  captureStatus,
  loading,
  onSelectWindow,
  onRefresh
}: DesktopAppPaneToolbarProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <AppWindow className="size-4 shrink-0 text-primary" />
      <span className="truncate font-medium">
        {selected
          ? selected.appName
          : translate(
              'auto.components.desktop.app.pane.desktop.app.pane.toolbar.883e3130f3',
              'Desktop App'
            )}
      </span>
      {captureStatus ? (
        <span className="shrink-0 text-2xs text-muted-foreground">
          {captureStatus === 'live'
            ? translate(
                'auto.components.desktop.app.pane.desktop.app.pane.toolbar.81d7882862',
                'Live'
              )
            : translate(
                'auto.components.desktop.app.pane.desktop.app.pane.toolbar.125a87c4a2',
                'Connecting…'
              )}
        </span>
      ) : null}
      <div className="flex-1" />
      <Select
        value={selected ? String(selected.windowId) : ''}
        onValueChange={(value) => onSelectWindow(Number(value))}
        disabled={windows.length === 0}
      >
        <SelectTrigger className="h-7 w-[220px]">
          <SelectValue
            placeholder={translate(
              'auto.components.desktop.app.pane.desktop.app.pane.toolbar.907a45c75b',
              'Choose window'
            )}
          />
        </SelectTrigger>
        <SelectContent position="popper" side="bottom" align="end" sideOffset={4}>
          {windows.map((w) => (
            <SelectItem key={w.windowId} value={String(w.windowId)}>
              {windowLabel(w)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon-xs"
            className="size-7"
            onClick={onRefresh}
            disabled={loading}
            aria-label={translate(
              'auto.components.desktop.app.pane.desktop.app.pane.toolbar.bd517e7e2b',
              'Refresh window list'
            )}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {translate(
            'auto.components.desktop.app.pane.desktop.app.pane.toolbar.bd517e7e2b',
            'Refresh window list'
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
