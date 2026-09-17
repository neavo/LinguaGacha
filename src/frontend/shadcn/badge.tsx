import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@frontend/shadcn/classnames";
import "./badge.css";

// 普通徽标和组合控件共用语义色，尺寸与颜色值由 badge.css 维护。
const badgeVariants = cva("app-badge", {
  variants: {
    tone: {
      neutral: "app-badge--neutral",
      brand: "app-badge--brand",
      success: "app-badge--success",
      warning: "app-badge--warning",
      failure: "app-badge--failure",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});

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

export { Badge, badgeVariants };
