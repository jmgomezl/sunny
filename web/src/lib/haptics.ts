type TelegramHaptics = {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: { HapticFeedback?: TelegramHaptics } }
  }
}

export type Haptic = 'soft' | 'light' | 'medium' | 'success' | 'warning'

/** Telegram's native haptics inside the Mini App; a tiny vibration elsewhere. */
export function haptic(kind: Haptic) {
  const tg = window.Telegram?.WebApp?.HapticFeedback
  if (tg) {
    if (kind === 'success' || kind === 'warning') tg.notificationOccurred(kind)
    else tg.impactOccurred(kind)
    return
  }
  navigator.vibrate?.(kind === 'soft' || kind === 'light' ? 8 : 18)
}
