import * as React from "react";

import { Button } from "@frontend/shadcn/button";

type AppButtonProps = Omit<React.ComponentProps<typeof Button>, "size" | "variant"> & {
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
  size?: "default" | "xs" | "sm" | "lg" | "toolbar" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
};

/** 统一应用按钮尺寸词表，并暴露 `data-size` 供组合控件样式消费。 */
function AppButton({
  className,
  variant = "default",
  size = "default",
  ...props
}: AppButtonProps): React.JSX.Element {
  return <Button variant={variant} size={size} data-size={size} className={className} {...props} />;
}

export { AppButton };
