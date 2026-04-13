import { useEffect, useEffectEvent } from 'react'

type UseSaveShortcutOptions = {
  enabled: boolean
  on_save: () => void | Promise<void>
}

function is_save_shortcut_event(event: KeyboardEvent): boolean {
  const pressed_key = event.key.toLowerCase()
  const has_primary_modifier = event.ctrlKey || event.metaKey

  if (event.isComposing) {
    return false
  } else if (event.altKey || event.shiftKey) {
    return false
  } else if (!has_primary_modifier) {
    return false
  } else {
    return pressed_key === 's'
  }
}

export function useSaveShortcut(options: UseSaveShortcutOptions): void {
  const handle_save_shortcut = useEffectEvent((): void => {
    void options.on_save()
  })

  useEffect(() => {
    if (!options.enabled) {
      return undefined
    } else {
      // 为什么：编辑器和多行输入框内部也要稳定拦截浏览器默认保存动作，
      // 所以统一在 window 捕获阶段处理 Ctrl/Cmd + S。
      const handle_keydown = (event: KeyboardEvent): void => {
        if (is_save_shortcut_event(event)) {
          event.preventDefault()
          handle_save_shortcut()
        }
      }

      window.addEventListener('keydown', handle_keydown, true)

      return () => {
        window.removeEventListener('keydown', handle_keydown, true)
      }
    }
  }, [options.enabled])
}
