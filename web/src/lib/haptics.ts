type TelegramHaptics = {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void
}

type TelegramBackButton = {
  show: () => void
  hide: () => void
  onClick: (cb: () => void) => void
  offClick: (cb: () => void) => void
}

type TelegramWebApp = {
  initData?: string
  initDataUnsafe?: { user?: { id?: number; first_name?: string } }
  BackButton?: TelegramBackButton
  ready: () => void
  expand: () => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  setBottomBarColor?: (color: string) => void
  HapticFeedback?: TelegramHaptics
  showScanQrPopup?: (params: { text?: string }, callback?: (data: string) => boolean | void) => void
  closeScanQrPopup?: () => void
  shareToStory?: (mediaUrl: string, params?: { text?: string }) => void
  openTelegramLink?: (url: string) => void
  isVersionAtLeast?: (version: string) => boolean
  colorScheme?: 'light' | 'dark'
  onEvent?: (event: 'themeChanged', handler: () => void) => void
  offEvent?: (event: 'themeChanged', handler: () => void) => void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

export type Haptic = 'soft' | 'light' | 'medium' | 'success' | 'warning'

/** Telegram's native haptics inside the Mini App; a tiny vibration elsewhere. */
export function haptic(kind: Haptic) {
  // Telegram's script loads everywhere, but its haptics only work (and only stay quiet) inside it.
  const tg = window.Telegram?.WebApp?.initData ? window.Telegram.WebApp.HapticFeedback : undefined
  if (tg) {
    if (kind === 'success' || kind === 'warning') tg.notificationOccurred(kind)
    else tg.impactOccurred(kind)
    return
  }
  navigator.vibrate?.(kind === 'soft' || kind === 'light' ? 8 : 18)
}
