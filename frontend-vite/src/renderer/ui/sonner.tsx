import type { CSSProperties } from 'react'
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

function resolve_toaster_theme(resolved_theme: string | undefined): ToasterProps['theme'] {
  if (resolved_theme === 'dark') {
    return 'dark'
  } else if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
    return 'dark'
  } else {
    return 'light'
  }
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()
  const theme = resolve_toaster_theme(resolvedTheme)

  return (
    <Sonner
      theme={theme}
      position="top-center"
      offset={{
        top: 56,
      }}
      visibleToasts={4}
      closeButton
      expand={false}
      className="toaster group"
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
          '--border-radius': 'var(--radius)',
          fontFamily: 'var(--ui-font-family-base)',
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

export { Toaster }
