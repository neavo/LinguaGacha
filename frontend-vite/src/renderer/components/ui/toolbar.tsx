import * as React from "react"

import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

function Toolbar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toolbar"
      className={cn("flex items-center justify-between gap-4", className)}
      {...props}
    />
  )
}

function ToolbarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toolbar-group"
      className={cn("flex flex-wrap items-center gap-3", className)}
      {...props}
    />
  )
}

function ToolbarHint({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="toolbar-hint"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function ToolbarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="toolbar-separator"
      orientation="vertical"
      className={cn("toolbar-separator", className)}
      {...props}
    />
  )
}

export { Toolbar, ToolbarGroup, ToolbarHint, ToolbarSeparator }
