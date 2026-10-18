import { TITLE_BAR_HEIGHT } from '@shared/constants'

/**
 * Invisible strip over the top of the window that lets the user drag it. The native
 * controls (Windows/Linux overlay, macOS traffic lights) are drawn on top by Electron,
 * so the sidebar and page backgrounds run seamlessly up to the window edge.
 */
export function TitleBar() {
  return (
    <div
      data-testid="title-bar"
      aria-hidden
      className="app-drag fixed inset-x-0 top-0 z-40"
      style={{ height: TITLE_BAR_HEIGHT }}
    />
  )
}
