import type { ReactNode } from 'react'

import { render_rich_text, type RichTextComponentMap } from '@/i18n'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/shadcn/card'
import '@/widgets/setting-card-row/setting-card-row.css'

type SettingCardRowProps = {
  title: string
  description: ReactNode
  action: ReactNode
  className?: string
  title_suffix?: ReactNode
}

const DESCRIPTION_COMPONENT_MAP: RichTextComponentMap = {
  emphasis: (children) => {
    return (
      <span className="setting-card-row__description-emphasis font-medium">
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
            <h2 className="setting-card-row__title font-medium">{props.title}</h2>
            {props.title_suffix !== undefined
              ? <div className="setting-card-row__title-suffix">{props.title_suffix}</div>
              : null}
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

