import { BadgeHelp } from 'lucide-react'

import { open_external_url } from '@/app/desktop-api'
import { cn } from '@/lib/utils'
import { Button } from '@/shadcn/button'

type SettingHelpButtonProps = {
  url: string
  aria_label: string
  className?: string
}

export function SettingHelpButton(props: SettingHelpButtonProps): JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn(props.className)}
      aria-label={props.aria_label}
      onClick={() => {
        void open_external_url(props.url)
      }}
    >
      <BadgeHelp />
    </Button>
  )
}
