import type { ReactNode } from "react";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";

import { cn } from "@frontend/shadcn/classnames";

export type SegmentedToggleOption<Value extends string> = {
  value: Value;
  label: ReactNode;
};

type SegmentedToggleProps<Value extends string> = {
  aria_label: string;
  value: Value;
  options: readonly SegmentedToggleOption<Value>[];
  disabled?: boolean;
  className?: string;
  stretch?: boolean;
  on_value_change: (next_value: Value) => void;
};

/** 将 Base UI 的数组型单选值收口为应用层的标量值，避免页面重复处理空选项。 */
export function SegmentedToggle<Value extends string>(
  props: SegmentedToggleProps<Value>,
): JSX.Element {
  return (
    <ToggleGroup
      multiple={false}
      aria-label={props.aria_label}
      className={cn(
        "flex w-fit items-center",
        props.stretch ? "w-full" : undefined,
        props.className,
      )}
      value={[props.value]}
      disabled={props.disabled}
      onValueChange={(next_values) => {
        // 单选组理论上只返回一个值；忽略空数组可避免误触发业务回调清空状态。
        const next_value = next_values[0];
        if (next_value !== undefined) props.on_value_change(next_value);
      }}
    >
      {props.options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          className={cn(
            "inline-flex h-7 min-w-16 shrink-0 items-center justify-center rounded-none border border-input bg-background px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none first:rounded-l-[var(--ui-radius-button)] last:rounded-r-[var(--ui-radius-button)] not-first:border-l-0 hover:bg-muted hover:text-foreground focus:z-10 focus-visible:z-10 focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50 data-pressed:z-10 data-pressed:border-primary data-pressed:bg-primary data-pressed:text-primary-foreground data-pressed:hover:bg-primary/92 data-pressed:hover:text-primary-foreground",
            props.stretch ? "flex-1" : undefined,
          )}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
