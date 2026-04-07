import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// 通过变体统一卡片视觉，让页面层只负责布局与信息密度。
const cardVariants = cva(
  "card-surface rounded-[var(--card-radius-current)] text-card-foreground",
  {
    variants: {
      variant: {
        default: "",
        panel: "",
        table: "",
        toolbar: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

// 通过显式标记可交互卡片，把 hover / active 限制在真正可点击的容器上。
function resolve_card_is_interactive(props: React.ComponentProps<"section">): boolean {
  if (props.onClick !== undefined) {
    return true
  } else if (props.onKeyDown !== undefined || props.onKeyUp !== undefined) {
    return true
  } else if (props.role === "button" || props.role === "link") {
    return true
  } else if (props.tabIndex !== undefined && props.tabIndex >= 0) {
    return true
  } else {
    return false
  }
}

function Card({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"section"> &
  VariantProps<typeof cardVariants>) {
  const is_interactive = resolve_card_is_interactive(props)

  return (
    <section
      data-slot="card"
      data-variant={variant}
      data-interactive={is_interactive ? "true" : undefined}
      className={cn(
        cardVariants({ variant }),
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex min-w-0 flex-col", className)}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      data-ui-text="emphasis"
      className={cn("min-w-0 text-[14px] leading-[1.25] tracking-[-0.018em] text-foreground", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("min-w-0 text-[12px] leading-[1.4] text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("min-w-0", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center", className)}
      {...props}
    />
  )
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }
