import type { ReactNode } from 'react'

import { render_rich_text, type RichTextComponentMap } from '@/i18n'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/ui/card'

type SettingCardRowProps = {
  title: string
  description: ReactNode
  action: ReactNode
  className?: string
}

const DESCRIPTION_COMPONENT_MAP: RichTextComponentMap = {
  emphasis: (children) => {
    return (
      <span className="setting-card-row__description-emphasis" data-ui-text="emphasis">
        {children}
      </span>
    )
  },
}

export function SettingCardRow(props: SettingCardRowProps): JSX.Element {
  const description_content = typeof props.description === 'string'
    ? render_rich_text(props.description, DESCRIPTION_COMPONENT_MAP)
    : props.description

  return (
    <Card className={cn('setting-card-row', props.className)}>
      <CardContent className="setting-card-row__content">
        <div className="setting-card-row__copy">
          <div className="setting-card-row__heading">
            <h2 className="setting-card-row__title" data-ui-text="emphasis">{props.title}</h2>
          </div>
          <p className="setting-card-row__description">{description_content}</p>
        </div>

        <div className="setting-card-row__action">
          {props.action}
        </div>
      </CardContent>
    </Card>
  )
}
