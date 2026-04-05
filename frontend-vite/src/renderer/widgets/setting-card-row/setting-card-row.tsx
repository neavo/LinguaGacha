import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/ui/card'

type SettingCardRowProps = {
  title: string
  description: string
  action: ReactNode
  className?: string
}

type DescriptionSegment = {
  kind: 'text' | 'emphasis'
  value: string
}

const DESCRIPTION_EMPHASIS_PATTERN = /<font color=['"]darkgoldenrod['"]><b>(.*?)<\/b><\/font>/gu

function parse_description_segments(description_line: string): DescriptionSegment[] {
  const segments: DescriptionSegment[] = []
  let matched_result: RegExpExecArray | null = DESCRIPTION_EMPHASIS_PATTERN.exec(description_line)
  let previous_index = 0

  while (matched_result !== null) {
    if (matched_result.index > previous_index) {
      segments.push({
        kind: 'text',
        value: description_line.slice(previous_index, matched_result.index),
      })
    }

    segments.push({
      kind: 'emphasis',
      value: matched_result[1],
    })

    previous_index = matched_result.index + matched_result[0].length
    matched_result = DESCRIPTION_EMPHASIS_PATTERN.exec(description_line)
  }

  if (previous_index < description_line.length) {
    segments.push({
      kind: 'text',
      value: description_line.slice(previous_index),
    })
  }

  if (segments.length === 0) {
    return [
      {
        kind: 'text',
        value: description_line,
      },
    ]
  } else {
    return segments
  }
}

function render_description_line(title: string, description_line: string, line_index: number): ReactNode {
  const segments = parse_description_segments(description_line)

  return segments.map((segment, segment_index) => {
    const key = `${title}-${line_index}-${segment_index}`

    if (segment.kind === 'emphasis') {
      return (
        <span
          key={key}
          className="setting-card-row__description-emphasis"
          data-ui-text="emphasis"
        >
          {segment.value}
        </span>
      )
    } else {
      return <span key={key}>{segment.value}</span>
    }
  })
}

export function SettingCardRow(props: SettingCardRowProps): JSX.Element {
  const description_lines = props.description.split('<br>')

  DESCRIPTION_EMPHASIS_PATTERN.lastIndex = 0

  return (
    <Card className={cn('setting-card-row', props.className)}>
      <CardContent className="setting-card-row__content">
        <div className="setting-card-row__copy">
          <div className="setting-card-row__heading">
            <h2 className="setting-card-row__title" data-ui-text="emphasis">{props.title}</h2>
          </div>
          <p className="setting-card-row__description">
            {description_lines.map((line, line_index) => {
              const is_last_line = line_index === description_lines.length - 1

              return (
                <span key={`${props.title}-${line_index}`}>
                  {render_description_line(props.title, line, line_index)}
                  {is_last_line ? null : <br />}
                </span>
              )
            })}
          </p>
        </div>

        <div className="setting-card-row__action">
          {props.action}
        </div>
      </CardContent>
    </Card>
  )
}
