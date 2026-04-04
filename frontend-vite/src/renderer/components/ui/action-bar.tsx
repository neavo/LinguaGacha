import * as React from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Toolbar, ToolbarGroup, ToolbarHint, ToolbarSeparator } from "@/components/ui/toolbar"
import { cn } from "@/lib/utils"

type ActionBarProps = React.ComponentProps<"section"> & {
  title?: React.ReactNode
  description?: React.ReactNode
  hint?: React.ReactNode
  actions: React.ReactNode
}

function ActionBar({
  className,
  title,
  description,
  hint,
  actions,
  ...props
}: ActionBarProps) {
  const has_a11y_copy = title !== undefined || description !== undefined

  return (
    <Card
      variant="toolbar"
      data-component="action-bar"
      className={cn("action-bar", className)}
      {...props}
    >
      {has_a11y_copy ? (
        <CardHeader className="sr-only">
          {title !== undefined ? <CardTitle>{title}</CardTitle> : null}
          {description !== undefined ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
      ) : null}
      <CardContent>
        <Toolbar className="action-bar__toolbar">
          <ToolbarGroup>{actions}</ToolbarGroup>
          {hint !== undefined ? <ToolbarHint>{hint}</ToolbarHint> : null}
        </Toolbar>
      </CardContent>
    </Card>
  )
}

function ActionBarSeparator({ className, ...props }: React.ComponentProps<typeof ToolbarSeparator>) {
  return (
    <ToolbarSeparator
      className={cn("action-bar__separator", className)}
      {...props}
    />
  )
}

export { ActionBar, ActionBarSeparator }
