import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const emptyVariants = cva(
  "flex min-h-[180px] flex-col items-center justify-center gap-4 rounded-[var(--ui-radius-card)] px-6 py-8 text-center text-card-foreground",
  {
    variants: {
      variant: {
        dashed: "border border-dashed border-border bg-card/70",
        inset:
          "border border-[color:var(--ui-card-default-border)] bg-[var(--ui-card-default-surface)] shadow-[var(--ui-card-default-shadow)]",
      },
    },
    defaultVariants: {
      variant: "dashed",
    },
  }
)

function Empty({
  className,
  variant = "dashed",
  ...props
}: React.ComponentProps<"section"> &
  VariantProps<typeof emptyVariants>) {
  return (
    <section
      data-slot="empty"
      className={cn(
        emptyVariants({ variant }),
        className
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex flex-col items-center gap-3", className)}
      {...props}
    />
  )
}

function EmptyMedia({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-media"
      className={cn(
        "inline-flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="empty-title"
      data-ui-text="emphasis"
      className={cn("text-sm text-foreground", className)}
      {...props}
    />
  )
}

function EmptyDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn("max-w-sm text-sm leading-6 text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
}
