import * as React from 'react'

import { cn } from '@/lib/utils'
import '@/widgets/command-bar/command-bar.css'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card'
import { Separator } from '@/ui/separator'

type CommandBarProps = React.ComponentProps<'section'> & {
  title?: React.ReactNode
  description?: React.ReactNode
  hint?: React.ReactNode
  actions: React.ReactNode
}

function CommandBarToolbar({
  className,
  ...props
}: React.ComponentProps<'div'>): JSX.Element {
  return <div className={cn('command-bar__toolbar', className)} {...props} />
}

function CommandBarActions({
  className,
  ...props
}: React.ComponentProps<'div'>): JSX.Element {
  return <div className={cn('command-bar__actions', className)} {...props} />
}

function CommandBarHint({
  className,
  ...props
}: React.ComponentProps<'span'>): JSX.Element {
  return <span className={cn('command-bar__hint', className)} {...props} />
}

function CommandBarSeparatorPrimitive({
  className,
  ...props
}: React.ComponentProps<typeof Separator>): JSX.Element {
  return (
    <Separator
      orientation="vertical"
      className={cn('command-bar__separator', className)}
      {...props}
    />
  )
}

export function CommandBar({
  className,
  title,
  description,
  hint,
  actions,
  ...props
}: CommandBarProps): JSX.Element {
  // 保留隐藏标题与描述，确保动作条在辅助技术里仍有清晰语义。
  const has_a11y_copy = title !== undefined || description !== undefined

  return (
    <Card
      variant="toolbar"
      className={cn('command-bar', className)}
      {...props}
    >
      {has_a11y_copy
        ? (
            <CardHeader className="sr-only">
              {title !== undefined ? <CardTitle>{title}</CardTitle> : null}
              {description !== undefined
                ? <CardDescription>{description}</CardDescription>
                : null}
            </CardHeader>
          )
        : null}
      <CardContent>
        <CommandBarToolbar>
          <CommandBarActions>
            {actions}
          </CommandBarActions>
          {hint !== undefined
            ? (
                <CommandBarHint>
                  {hint}
                </CommandBarHint>
              )
            : null}
        </CommandBarToolbar>
      </CardContent>
    </Card>
  )
}

export function CommandBarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>): JSX.Element {
  return <CommandBarSeparatorPrimitive className={className} {...props} />
}

export function CommandBarGroup({
  className,
  ...props
}: React.ComponentProps<'div'>): JSX.Element {
  // 统一提供零间距动作组，避免每个页面重复声明连体按钮样式。
  return <div className={cn('command-bar__group', className)} {...props} />
}
