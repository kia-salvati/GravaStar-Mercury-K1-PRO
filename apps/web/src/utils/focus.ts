let restoring = false

/**
 * Moves focus as the app's own doing, not the user's. Handlers that preview on focus check
 * `isRestoringFocus`, so restoring focus after a sheet closes never changes the preview.
 */
export function focusWithoutPreview(element: HTMLElement | null): void {
  if (!element) return
  restoring = true
  try {
    element.focus()
  } finally {
    restoring = false
  }
}

export const isRestoringFocus = (): boolean => restoring
