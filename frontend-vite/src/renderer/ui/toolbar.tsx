import * as React from "react"

import { Separator } from "@/ui/separator"
import { cn } from "@/lib/utils"

function Toolbar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toolbar"
      className={cn(className)}
      {...props}
    />
  )
}

function ToolbarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toolbar-group"
      className={cn(className)}
      {...props}
    />
  )
}

function ToolbarHint({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="toolbar-hint"
      className={cn(className)}
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
