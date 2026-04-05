import type { ReactNode } from 'react'

import { Card, CardContent } from '@/ui/card'
import { cn } from '@/lib/utils'

type SettingCardRowProps = {
  title: string
  description: string
  action: ReactNode
  className?: string
}

export function SettingCardRow(props: SettingCardRowProps): JSX.Element {
  const description_lines = props.description.split('<br>')

  return (
    <Card className={cn('basic-settings-page__card', props.className)}>
      <CardContent className="basic-settings-page__card-content">
        <div className="basic-settings-page__card-copy">
          <div className="basic-settings-page__card-heading">
            <h2 className="basic-settings-page__card-title" data-ui-text="emphasis">{props.title}</h2>
          </div>
          <p className="basic-settings-page__card-description">
            {description_lines.map((line, index) => {
              const key = `${props.title}-${index}`
              const is_last_line = index === description_lines.length - 1

              return (
                <span key={key}>
                  {line}
                  {is_last_line ? null : <br />}
                </span>
              )
            })}
          </p>
        </div>

        <div className="basic-settings-page__card-action">
          {props.action}
        </div>
      </CardContent>
    </Card>
  )
}
