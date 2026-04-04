import { useEffect, useState, type CSSProperties } from 'react'
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

function read_toaster_theme(): ToasterProps['theme'] {
  if (typeof document === 'undefined') {
    return 'light'
  }

  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function Toaster(props: ToasterProps): JSX.Element {
  const [theme, set_theme] = useState<ToasterProps['theme']>(() => read_toaster_theme())

  useEffect(() => {
    const root_element = document.documentElement

    function sync_theme(): void {
      set_theme(read_toaster_theme())
    }

    sync_theme()

    // 监听根元素类名变化，让 toast 跟随应用主题切换
    const observer = new MutationObserver(sync_theme)
    observer.observe(root_element, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <Sonner
      theme={theme}
      position="top-right"
      offset={{
        top: 56,
        right: 20,
      }}
      visibleToasts={4}
      closeButton
      expand={false}
      className="toaster"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': '12px',
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
          content: 'cn-toast__content',
          title: 'cn-toast__title',
          description: 'cn-toast__description',
          icon: 'cn-toast__icon',
          closeButton: 'cn-toast__close',
          success: 'cn-toast--success',
          info: 'cn-toast--info',
          warning: 'cn-toast--warning',
          error: 'cn-toast--error',
          loading: 'cn-toast--loading',
          default: 'cn-toast--default',
        },
      }}
      {...props}
    />
  )
}
