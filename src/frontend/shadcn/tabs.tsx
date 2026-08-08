import type { ComponentProps } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "@frontend/shadcn/classnames";

function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>): JSX.Element {
  return (
    <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col", className)} {...props} />
  );
}

function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>): JSX.Element {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-8 w-fit items-center rounded-[var(--ui-radius-button)] bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>): JSX.Element {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-6 min-w-16 items-center justify-center rounded-[var(--ui-radius-button)] px-3 text-xs font-medium transition-colors outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring data-[state=active]:bg-popover data-[state=active]:text-foreground data-[state=active]:shadow-xs disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>): JSX.Element {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("min-h-0 flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
