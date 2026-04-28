import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/shadcn/button";

type ShadcnButtonProps = React.ComponentProps<typeof Button>;
type ShadcnButtonSize = NonNullable<ShadcnButtonProps["size"]>;
type AppButtonSize = ShadcnButtonSize | "toolbar";

const appButtonVariants = cva("rounded-[4px] text-[13px]", {
  variants: {
    variant: {
      default: "hover:bg-primary/90",
      outline: null,
      secondary: null,
      ghost: null,
      destructive: null,
      link: null,
    },
    size: {
      default: null,
      xs: "rounded-[4px] in-data-[slot=button-group]:rounded-[4px]",
      sm: "rounded-[4px] in-data-[slot=button-group]:rounded-[4px]",
      lg: null,
      toolbar:
        "h-[var(--ui-toolbar-button-height)] gap-2 rounded-[4px] px-[var(--ui-toolbar-button-padding-x)] text-[12px] has-data-[icon=inline-end]:pr-[calc(var(--ui-toolbar-button-padding-x)-2px)] has-data-[icon=inline-start]:pl-[calc(var(--ui-toolbar-button-padding-x)-2px)]",
      icon: null,
      "icon-xs":
        "rounded-[4px] in-data-[slot=button-group]:rounded-[4px] [&_svg:not([class*='size-'])]:size-3",
      "icon-sm": "rounded-[4px] in-data-[slot=button-group]:rounded-[4px]",
      "icon-lg": null,
    },
  },
});

type AppButtonProps = Omit<ShadcnButtonProps, "size"> &
  VariantProps<typeof appButtonVariants> & {
    size?: AppButtonSize;
  };

function AppButton({
  className,
  variant = "default",
  size = "default",
  ...props
}: AppButtonProps): JSX.Element {
  const shadcn_size: ShadcnButtonSize = size === "toolbar" ? "default" : size;

  return (
    <Button
      variant={variant}
      size={shadcn_size}
      data-size={size}
      className={cn(appButtonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { AppButton, appButtonVariants };
