import * as React from "react";

import { Button } from "@frontend/shadcn/button";

type AppButtonProps = Omit<React.ComponentProps<typeof Button>, "size" | "variant"> & {
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
  size?: "default" | "xs" | "sm" | "lg" | "toolbar" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
};

function AppButton({
  className,
  variant = "default",
  size = "default",
  ...props
}: AppButtonProps): JSX.Element {
  return <Button variant={variant} size={size} data-size={size} className={className} {...props} />;
}

export { AppButton };
