import * as React from "react";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@frontend/shadcn/classnames";
import { badgeVariants } from "./badge-variants";

/** 透传原生 span 属性，供 Tooltip、姓名和状态提示共用。 */
function Badge({
  className,
  tone = "neutral",
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      data-tone={tone}
      className={cn(badgeVariants({ tone }), className)}
      {...props}
    />
  );
}

export { Badge };
