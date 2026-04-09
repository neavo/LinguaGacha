import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card'

type DataTableFrameProps = {
  title: ReactNode
  description?: ReactNode
  empty_state: ReactNode | null
  header: ReactNode | null
  body: ReactNode | null
  className?: string
  content_class_name?: string
}

export function DataTableFrame(props: DataTableFrameProps): JSX.Element {
  return (
    <Card variant="table" className={props.className}>
      <CardHeader className="sr-only">
        <CardTitle>{props.title}</CardTitle>
        {props.description === undefined
          ? null
          : <CardDescription>{props.description}</CardDescription>}
      </CardHeader>
      <CardContent className={props.content_class_name}>
        {props.empty_state !== null
          ? props.empty_state
          : (
              <div className={cn('flex min-h-0 flex-1 flex-col')}>
                {props.header}
                {props.body}
              </div>
            )}
      </CardContent>
    </Card>
  )
}
