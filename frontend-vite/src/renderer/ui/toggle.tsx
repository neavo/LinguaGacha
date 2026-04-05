import * as React from "react"
import { Toggle as TogglePrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { toggle_variants, type ToggleVariantProps } from "@/ui/toggle-variants"

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  ToggleVariantProps) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggle_variants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle }
