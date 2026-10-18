import { BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions } from 'electron'

function parentWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

/** Native "open" dialog attached to the app window; null when cancelled. */
export async function pickPath(options: OpenDialogOptions): Promise<string | null> {
  const window = parentWindow()
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

/** Native "save as" dialog; null when cancelled. */
export async function pickSavePath(options: SaveDialogOptions): Promise<string | null> {
  const window = parentWindow()
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  return result.canceled ? null : (result.filePath ?? null)
}
