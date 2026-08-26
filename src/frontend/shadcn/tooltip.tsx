"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@frontend/shadcn/classnames";

const tooltipContentClassName =
  "z-(--ui-layer-tooltip) inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

const TOOLTIP_WINDOW_DEACTIVATED = "linguagacha:tooltip-window-deactivated";

type TooltipWindowActivationContext = {
  suppressed_ref: React.RefObject<boolean>;
  activation_revision: number;
};

const TooltipWindowActivationContext = React.createContext<TooltipWindowActivationContext | null>(
  null,
);

function TooltipProvider({
  delayDuration = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  const suppressed_ref = React.useRef(false);
  const pointer_position_ref = React.useRef<{ x: number; y: number } | null>(null);
  const [activation_revision, set_activation_revision] = React.useState(0);

  React.useEffect(() => {
    const suppress_tooltips = (): void => {
      suppressed_ref.current = true;
      set_activation_revision((revision) => revision + 1);
      document.dispatchEvent(new Event(TOOLTIP_WINDOW_DEACTIVATED));
    };
    const release_tooltip_suppression = (): void => {
      if (!suppressed_ref.current) return;
      suppressed_ref.current = false;
    };
    const handle_pointer_move = (event: PointerEvent): void => {
      const previous = pointer_position_ref.current;
      pointer_position_ref.current = { x: event.clientX, y: event.clientY };
      if (
        suppressed_ref.current &&
        (previous === null || (previous.x === event.clientX && previous.y === event.clientY))
      ) {
        // Ignore the synthetic stationary pointer move emitted while a window is restored.
        event.stopPropagation();
        return;
      }
      release_tooltip_suppression();
    };
    const handle_pointer_down = (): void => release_tooltip_suppression();
    const handle_key_down = (): void => release_tooltip_suppression();
    const handle_visibility_change = (): void => suppress_tooltips();

    window.addEventListener("blur", suppress_tooltips);
    window.addEventListener("focus", suppress_tooltips);
    window.addEventListener("pointermove", handle_pointer_move, true);
    window.addEventListener("pointerdown", handle_pointer_down, true);
    window.addEventListener("keydown", handle_key_down, true);
    document.addEventListener("visibilitychange", handle_visibility_change);
    return () => {
      window.removeEventListener("blur", suppress_tooltips);
      window.removeEventListener("focus", suppress_tooltips);
      window.removeEventListener("pointermove", handle_pointer_move, true);
      window.removeEventListener("pointerdown", handle_pointer_down, true);
      window.removeEventListener("keydown", handle_key_down, true);
      document.removeEventListener("visibilitychange", handle_visibility_change);
    };
  }, []);

  return (
    <TooltipWindowActivationContext.Provider value={{ suppressed_ref, activation_revision }}>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        {...props}
      >
        {children}
      </TooltipPrimitive.Provider>
    </TooltipWindowActivationContext.Provider>
  );
}

function Tooltip({
  open: open_prop,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const window_activation = React.useContext(TooltipWindowActivationContext);
  const controlled = open_prop !== undefined;
  const [uncontrolled_open, set_uncontrolled_open] = React.useState(defaultOpen ?? false);
  const open = controlled ? open_prop : uncontrolled_open;
  const handle_open_change = React.useCallback(
    (next_open: boolean): void => {
      if (next_open && window_activation?.suppressed_ref.current) return;
      if (!controlled) set_uncontrolled_open(next_open);
      onOpenChange?.(next_open);
    },
    [controlled, onOpenChange, window_activation],
  );

  React.useEffect(() => {
    const close_tooltip = (): void => {
      if (!controlled) set_uncontrolled_open(false);
      onOpenChange?.(false);
    };
    document.addEventListener(TOOLTIP_WINDOW_DEACTIVATED, close_tooltip);
    return () => document.removeEventListener(TOOLTIP_WINDOW_DEACTIVATED, close_tooltip);
  }, [controlled, onOpenChange]);

  return (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      {...props}
      open={open}
      onOpenChange={handle_open_change}
    />
  );
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const window_activation = React.useContext(TooltipWindowActivationContext);
  return (
    <TooltipPrimitive.Trigger
      key={window_activation?.activation_revision}
      data-slot="tooltip-trigger"
      {...props}
    />
  );
}

/** Keep Tooltip's hit target stable because disabled native controls cannot receive pointer events. */
function tooltip_trigger_target(trigger: React.ReactElement): React.ReactElement {
  return <span className="inline-flex">{trigger}</span>;
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(tooltipContentClassName, className)}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  tooltipContentClassName,
  tooltip_trigger_target,
};
