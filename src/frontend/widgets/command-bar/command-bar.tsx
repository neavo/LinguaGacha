import * as React from "react";

import { cn } from "@frontend/shadcn/classnames";
import "@frontend/widgets/command-bar/command-bar.css";
import { Card, CardContent } from "@frontend/shadcn/card";
import { Separator } from "@frontend/shadcn/separator";

type CommandBarProps = React.ComponentProps<"section"> & {
  hint?: React.ReactNode;
  actions: React.ReactNode;
};

function CommandBarToolbar({ className, ...props }: React.ComponentProps<"div">): JSX.Element {
  return <div className={cn("command-bar__toolbar", className)} {...props} />;
}

function CommandBarActions({ className, ...props }: React.ComponentProps<"div">): JSX.Element {
  return <div className={cn("command-bar__actions", className)} {...props} />;
}

function CommandBarHint({ className, ...props }: React.ComponentProps<"span">): JSX.Element {
  return <span className={cn("command-bar__hint", className)} {...props} />;
}

function CommandBarSeparatorPrimitive({
  className,
  ...props
}: React.ComponentProps<typeof Separator>): JSX.Element {
  return (
    <Separator
      orientation="vertical"
      className={cn("command-bar__separator", className)}
      {...props}
    />
  );
}

export function CommandBar({ className, hint, actions, ...props }: CommandBarProps): JSX.Element {
  return (
    <Card variant="toolbar" className={cn("command-bar", className)} {...props}>
      <CardContent>
        <CommandBarToolbar>
          <CommandBarActions>{actions}</CommandBarActions>
          {hint !== undefined ? <CommandBarHint>{hint}</CommandBarHint> : null}
        </CommandBarToolbar>
      </CardContent>
    </Card>
  );
}

export function CommandBarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>): JSX.Element {
  return <CommandBarSeparatorPrimitive className={className} {...props} />;
}

export function CommandBarGroup({ className, ...props }: React.ComponentProps<"div">): JSX.Element {
  // 统一提供零间距动作组，避免每个页面重复声明连体按钮样式
  return <div className={cn("command-bar__group", className)} {...props} />;
}
